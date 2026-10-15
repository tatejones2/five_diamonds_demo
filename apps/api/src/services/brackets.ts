// Native bracket builder (spec §10). Structure is persisted as a graph:
// brackets → rounds → matchups → slots, with advancement edges (one per matchup, one per slot).
import {
  buildSingleElimination,
  easternWallTimeToUtc,
  validateBracketGraph,
  type PublicBracket,
  type SlotPosition,
} from '@fd/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { db } from '../db/client';
import {
  bracketAdvancementEdges,
  bracketMatchups,
  bracketRounds,
  brackets,
  bracketSlots,
  divisions,
  games,
  gameVersions,
  registrations,
  teams,
} from '../db/schema';
import { audit } from '../lib/audit';
import type { AuthedContext } from '../lib/context';
import { ApiError, notFound, versionConflict } from '../lib/errors';
import { toProjection } from './schedule';
import { lockTournament } from './tournaments';

type BracketRow = typeof brackets.$inferSelect;

export async function createBracket(ctx: AuthedContext, tournamentId: string, input: { divisionId: string; name: string; size: number; entrants: number }) {
  let plan;
  try {
    plan = buildSingleElimination({ size: input.size, entrants: input.entrants });
  } catch (e) {
    throw new ApiError('VALIDATION_FAILED', (e as Error).message, { fields: { size: (e as Error).message } });
  }
  return db.transaction(async (tx) => {
    await lockTournament(tx, tournamentId);
    const [division] = await tx.select().from(divisions).where(and(eq(divisions.id, input.divisionId), eq(divisions.tournamentId, tournamentId)));
    if (!division) throw new ApiError('VALIDATION_FAILED', 'Choose a division in this tournament.', { fields: { divisionId: 'Invalid' } });
    const [b] = await tx
      .insert(brackets)
      .values({ tournamentId, divisionId: division.id, name: input.name, size: plan.size, entrants: plan.entrants, createdBy: ctx.user.id })
      .returning();
    const roundIds = new Map<number, string>();
    for (const r of plan.rounds) {
      const [row] = await tx.insert(bracketRounds).values({ bracketId: b!.id, roundNumber: r.round, name: r.name }).returning();
      roundIds.set(r.round, row!.id);
    }
    const matchupIds = new Map<string, string>();
    for (const m of plan.matchups) {
      const [row] = await tx
        .insert(bracketMatchups)
        .values({ bracketId: b!.id, roundId: roundIds.get(m.round)!, roundNumber: m.round, position: m.position, key: m.key })
        .returning();
      matchupIds.set(m.key, row!.id);
      await tx.insert(bracketSlots).values(m.slots.map((s) => ({ matchupId: row!.id, position: s.position, seed: s.seed, isBye: s.isBye })));
    }
    const edges = plan.edges.map((e) => ({ bracketId: b!.id, fromMatchupId: matchupIds.get(e.from)!, toMatchupId: matchupIds.get(e.to)!, toSlot: e.toSlot }));
    if (edges.length) await tx.insert(bracketAdvancementEdges).values(edges);
    const problems = validateBracketGraph(
      plan.matchups.map((m) => ({ id: matchupIds.get(m.key)!, round: m.round })),
      edges.map((e) => ({ fromMatchupId: e.fromMatchupId, toMatchupId: e.toMatchupId, toSlot: e.toSlot })),
    );
    if (problems.length) throw new ApiError('INTERNAL', 'Bracket structure failed integrity checks.', { problems });
    await audit(tx, ctx, { action: 'bracket.create', entityType: 'bracket', entityId: b!.id, tournamentId, summary: `${input.name}: ${plan.entrants} teams, size ${plan.size}` });
    return b!;
  });
}

async function lockBracket(tx: DbOrTx, bracketId: string) {
  const [b] = await tx.select().from(brackets).where(eq(brackets.id, bracketId)).for('update');
  if (!b) throw notFound('Bracket');
  return b;
}

async function loadGraph(tx: DbOrTx, bracketId: string) {
  const matchups = await tx.select().from(bracketMatchups).where(eq(bracketMatchups.bracketId, bracketId)).orderBy(asc(bracketMatchups.roundNumber), asc(bracketMatchups.position));
  const ids = matchups.map((m) => m.id);
  const slots = ids.length ? await tx.select().from(bracketSlots).where(inArray(bracketSlots.matchupId, ids)) : [];
  const edges = await tx.select().from(bracketAdvancementEdges).where(eq(bracketAdvancementEdges.bracketId, bracketId));
  const linked = ids.length ? await tx.select().from(games).where(inArray(games.bracketMatchupId, ids)) : [];
  return { matchups, slots, edges, games: linked.filter((g) => !g.deletedAt) };
}

const started = (g: typeof games.$inferSelect | undefined) =>
  !!g && (g.status === 'final' || g.status === 'in_progress' || g.status === 'suspended' || g.homeScore !== null || g.awayScore !== null);

/** Assign seeds → teams in round 1, then resolve byes. Allowed until any bracket game starts. */
export async function setSeeds(ctx: AuthedContext, bracketId: string, input: { version: number; seeds: { seed: number; teamId: string | null }[]; reason: string | null }) {
  return db.transaction(async (tx) => {
    const b = await lockBracket(tx, bracketId);
    if (b.version !== input.version) throw versionConflict();
    const g = await loadGraph(tx, bracketId);
    if (g.games.some(started)) throw new ApiError('CONFLICT', 'Seeds are locked once a bracket game has started. Use a logged override instead.');
    if (b.status === 'published' && !input.reason) throw new ApiError('VALIDATION_FAILED', 'Give a reason for changing seeds on a published bracket.', { fields: { reason: 'Required' } });

    const confirmed = await tx
      .select({ teamId: registrations.teamId })
      .from(registrations)
      .where(and(eq(registrations.divisionId, b.divisionId), eq(registrations.status, 'confirmed')));
    const allowed = new Set(confirmed.map((c) => c.teamId));
    const bySeed = new Map<number, string | null>();
    const used = new Set<string>();
    for (const s of input.seeds) {
      if (s.seed > b.entrants) throw new ApiError('VALIDATION_FAILED', `Seed ${s.seed} is a bye in a ${b.entrants}-team bracket.`);
      if (s.teamId) {
        if (!allowed.has(s.teamId)) throw new ApiError('VALIDATION_FAILED', `Seed ${s.seed}: that team is not confirmed in this division.`);
        if (used.has(s.teamId)) throw new ApiError('VALIDATION_FAILED', 'A team can only hold one seed.');
        used.add(s.teamId);
      }
      bySeed.set(s.seed, s.teamId);
    }

    // Reset everything, then re-apply seeds and byes.
    for (const slot of g.slots) {
      const m = g.matchups.find((x) => x.id === slot.matchupId)!;
      const teamId = m.roundNumber === 1 && slot.seed !== null && !slot.isBye ? (bySeed.get(slot.seed) ?? null) : null;
      await tx.update(bracketSlots).set({ teamId, filledBy: teamId ? 'seed' : null }).where(eq(bracketSlots.id, slot.id));
    }
    await tx.update(bracketMatchups).set({ winnerSlot: null }).where(eq(bracketMatchups.bracketId, bracketId));
    for (const m of g.matchups.filter((m) => m.roundNumber === 1)) {
      const [top, bottom] = (['top', 'bottom'] as const).map((p) => g.slots.find((s) => s.matchupId === m.id && s.position === p)!);
      const bye = top!.isBye ? 'top' : bottom!.isBye ? 'bottom' : null;
      if (!bye) continue;
      const winner: SlotPosition = bye === 'top' ? 'bottom' : 'top';
      const winnerTeam = bySeed.get((winner === 'top' ? top : bottom)!.seed!) ?? null;
      await tx.update(bracketMatchups).set({ winnerSlot: winner }).where(eq(bracketMatchups.id, m.id));
      if (winnerTeam) await placeWinner(tx, ctx, g.edges, m.id, winnerTeam, 'advancement', 'Bye');
    }
    await syncBracketGames(tx, ctx, bracketId);
    await tx.update(brackets).set({ version: b.version + 1, updatedAt: new Date() }).where(eq(brackets.id, bracketId));
    await audit(tx, ctx, { action: 'bracket.seed', entityType: 'bracket', entityId: bracketId, tournamentId: b.tournamentId, reason: input.reason, data: { seeds: input.seeds } });
  });
}

/** Put `teamId` into the slot the matchup's winner advances to. */
export async function placeWinner(
  tx: DbOrTx,
  ctx: AuthedContext,
  edges: (typeof bracketAdvancementEdges.$inferSelect)[],
  fromMatchupId: string,
  teamId: string | null,
  filledBy: 'advancement' | 'override',
  reason: string | null,
) {
  const edge = edges.find((e) => e.fromMatchupId === fromMatchupId);
  if (!edge) return null; // final: no successor
  await tx
    .update(bracketSlots)
    .set({ teamId, filledBy: teamId ? filledBy : null })
    .where(and(eq(bracketSlots.matchupId, edge.toMatchupId), eq(bracketSlots.position, edge.toSlot)));
  await syncMatchupGame(tx, ctx, edge.toMatchupId, reason);
  return edge;
}

/** Keep a matchup's linked game teams in sync with its slots (top = home, bottom = away). */
export async function syncMatchupGame(tx: DbOrTx, ctx: AuthedContext, matchupId: string, reason: string | null) {
  const [game] = await tx.select().from(games).where(and(eq(games.bracketMatchupId, matchupId))).for('update');
  if (!game || game.deletedAt) return;
  const slots = await tx.select().from(bracketSlots).where(eq(bracketSlots.matchupId, matchupId));
  const top = slots.find((s) => s.position === 'top')!;
  const bottom = slots.find((s) => s.position === 'bottom')!;
  const ph = await placeholders(tx, matchupId);
  const next = {
    homeTeamId: top.teamId,
    awayTeamId: bottom.teamId,
    homePlaceholder: top.teamId ? null : ph.top,
    awayPlaceholder: bottom.teamId ? null : ph.bottom,
  };
  if (next.homeTeamId === game.homeTeamId && next.awayTeamId === game.awayTeamId && next.homePlaceholder === game.homePlaceholder && next.awayPlaceholder === game.awayPlaceholder) return;
  const now = new Date();
  const [updated] = await tx.update(games).set({ ...next, version: game.version + 1, updatedAt: now }).where(eq(games.id, game.id)).returning();
  // Advancement is operational: if the game is already public, its public projection updates too.
  if (game.published) {
    const proj = { ...game.published, ...next };
    await tx.update(games).set({ published: proj, publishedAt: now }).where(eq(games.id, game.id));
  }
  await tx.insert(gameVersions).values({ gameId: game.id, kind: 'bracket_advance', snapshot: toProjection(updated!), actorUserId: ctx.user.id, reason });
}

async function placeholders(tx: DbOrTx, matchupId: string): Promise<{ top: string; bottom: string }> {
  const slots = await tx.select().from(bracketSlots).where(eq(bracketSlots.matchupId, matchupId));
  const feeders = await tx
    .select({ toSlot: bracketAdvancementEdges.toSlot, key: bracketMatchups.key, round: bracketMatchups.roundNumber, position: bracketMatchups.position })
    .from(bracketAdvancementEdges)
    .innerJoin(bracketMatchups, eq(bracketMatchups.id, bracketAdvancementEdges.fromMatchupId))
    .where(eq(bracketAdvancementEdges.toMatchupId, matchupId));
  const label = (p: SlotPosition) => {
    const f = feeders.find((x) => x.toSlot === p);
    if (f) return `Winner of R${f.round} Game ${f.position}`;
    const s = slots.find((x) => x.position === p);
    return s?.seed ? `Seed ${s.seed}` : 'TBD';
  };
  return { top: label('top'), bottom: label('bottom') };
}

async function syncBracketGames(tx: DbOrTx, ctx: AuthedContext, bracketId: string) {
  const ms = await tx.select({ id: bracketMatchups.id }).from(bracketMatchups).where(eq(bracketMatchups.bracketId, bracketId));
  for (const m of ms) await syncMatchupGame(tx, ctx, m.id, 'Seeding');
}

/** Create or reschedule the (draft) game for a matchup. Published via the normal schedule publish. */
export async function scheduleMatchup(
  ctx: AuthedContext,
  bracketId: string,
  input: { version: number; matchupId: string; fieldId: string | null; date: string | null; time: string | null; durationMinutes: number },
) {
  return db.transaction(async (tx) => {
    const b = await lockBracket(tx, bracketId);
    if (b.version !== input.version) throw versionConflict();
    const [m] = await tx.select().from(bracketMatchups).where(and(eq(bracketMatchups.id, input.matchupId), eq(bracketMatchups.bracketId, bracketId)));
    if (!m) throw notFound('Matchup');
    const slots = await tx.select().from(bracketSlots).where(eq(bracketSlots.matchupId, m.id));
    if (slots.some((s) => s.isBye)) throw new ApiError('CONFLICT', 'A bye matchup has no game to schedule.');
    const [round] = await tx.select().from(bracketRounds).where(eq(bracketRounds.id, m.roundId));
    const startsAt = input.date && input.time ? easternWallTimeToUtc(input.date, input.time) : null;
    const label = `${round!.name}${round!.roundNumber < Math.log2(b.size) ? ` · Game ${m.position}` : ''}`;
    const [existing] = await tx.select().from(games).where(eq(games.bracketMatchupId, m.id)).for('update');
    let gameId: string;
    if (existing && !existing.deletedAt) {
      const [g] = await tx
        .update(games)
        .set({ fieldId: input.fieldId, startsAt, durationMinutes: input.durationMinutes, label, version: existing.version + 1, updatedAt: new Date() })
        .where(eq(games.id, existing.id))
        .returning();
      gameId = g!.id;
    } else {
      const [g] = await tx
        .insert(games)
        .values({ tournamentId: b.tournamentId, divisionId: b.divisionId, stage: 'bracket', label, fieldId: input.fieldId, startsAt, durationMinutes: input.durationMinutes, bracketMatchupId: m.id, homePlaceholder: 'TBD', awayPlaceholder: 'TBD' })
        .returning();
      gameId = g!.id;
    }
    await syncMatchupGame(tx, ctx, m.id, 'Scheduled bracket game');
    await tx.update(brackets).set({ version: b.version + 1, updatedAt: new Date() }).where(eq(brackets.id, bracketId));
    return { gameId };
  });
}

export async function publishBracket(ctx: AuthedContext, bracketId: string, version: number) {
  return db.transaction(async (tx) => {
    const b = await lockBracket(tx, bracketId);
    if (b.version !== version) throw versionConflict();
    const g = await loadGraph(tx, bracketId);
    const unseeded = g.slots.filter((s) => {
      const m = g.matchups.find((x) => x.id === s.matchupId)!;
      return m.roundNumber === 1 && !s.isBye && !s.teamId;
    });
    if (unseeded.length) throw new ApiError('CONFLICT', `Assign all ${b.entrants} seeds before publishing (${unseeded.length} open).`);
    const problems = validateBracketGraph(
      g.matchups.map((m) => ({ id: m.id, round: m.roundNumber })),
      g.edges.map((e) => ({ fromMatchupId: e.fromMatchupId, toMatchupId: e.toMatchupId, toSlot: e.toSlot })),
    );
    if (problems.length) throw new ApiError('CONFLICT', 'Bracket structure is invalid.', { problems });
    const now = new Date();
    await tx.update(brackets).set({ status: 'published', publishedAt: b.publishedAt ?? now, version: b.version + 1, updatedAt: now }).where(eq(brackets.id, bracketId));
    await audit(tx, ctx, { action: 'bracket.publish', entityType: 'bracket', entityId: bracketId, tournamentId: b.tournamentId });
  });
}

/** Director override of a slot occupant, with reason (spec §10). Blocked if the matchup's game is final. */
export async function overrideSlot(ctx: AuthedContext, bracketId: string, input: { version: number; slotId: string; teamId: string | null; reason: string }) {
  return db.transaction(async (tx) => {
    const b = await lockBracket(tx, bracketId);
    if (b.version !== input.version) throw versionConflict();
    const [slot] = await tx
      .select({ s: bracketSlots, bracketId: bracketMatchups.bracketId })
      .from(bracketSlots)
      .innerJoin(bracketMatchups, eq(bracketMatchups.id, bracketSlots.matchupId))
      .where(eq(bracketSlots.id, input.slotId));
    if (!slot || slot.bracketId !== bracketId) throw notFound('Slot');
    if (slot.s.isBye) throw new ApiError('CONFLICT', 'A bye slot cannot hold a team.');
    const [game] = await tx.select().from(games).where(eq(games.bracketMatchupId, slot.s.matchupId));
    if (game && !game.deletedAt && started(game)) throw new ApiError('CONFLICT', 'This game has already started. Correct its result instead.');
    if (input.teamId) {
      const [ok] = await tx
        .select({ id: registrations.id })
        .from(registrations)
        .where(and(eq(registrations.divisionId, b.divisionId), eq(registrations.teamId, input.teamId), eq(registrations.status, 'confirmed')));
      if (!ok) throw new ApiError('VALIDATION_FAILED', 'That team is not confirmed in this division.');
    }
    await tx.update(bracketSlots).set({ teamId: input.teamId, filledBy: input.teamId ? 'override' : null }).where(eq(bracketSlots.id, input.slotId));
    await syncMatchupGame(tx, ctx, slot.s.matchupId, input.reason);
    await tx.update(brackets).set({ version: b.version + 1, updatedAt: new Date() }).where(eq(brackets.id, bracketId));
    await audit(tx, ctx, { action: 'bracket.override_slot', entityType: 'bracket', entityId: bracketId, tournamentId: b.tournamentId, reason: input.reason, data: { slotId: input.slotId, from: slot.s.teamId, to: input.teamId } });
  });
}

export async function deleteBracket(ctx: AuthedContext, bracketId: string) {
  return db.transaction(async (tx) => {
    const b = await lockBracket(tx, bracketId);
    const g = await loadGraph(tx, bracketId);
    if (g.games.some((x) => x.published || started(x))) throw new ApiError('CONFLICT', 'This bracket has published or started games and cannot be deleted.');
    if (g.games.length) await tx.delete(games).where(inArray(games.id, g.games.map((x) => x.id)));
    await tx.delete(brackets).where(eq(brackets.id, bracketId));
    await audit(tx, ctx, { action: 'bracket.delete', entityType: 'bracket', entityId: bracketId, tournamentId: b.tournamentId, summary: b.name });
  });
}

// ---- Read models ------------------------------------------------------------------------------

export async function listBrackets(tournamentId: string, opts: { publishedOnly: boolean }) {
  const rows = await db
    .select()
    .from(brackets)
    .where(and(eq(brackets.tournamentId, tournamentId), opts.publishedOnly ? eq(brackets.status, 'published') : undefined))
    .orderBy(asc(brackets.createdAt));
  return rows;
}

/**
 * Build the bracket view. `gameView` maps a game row to the caller's projection, so the public API
 * only ever sees published game data while admins see the draft.
 */
export async function bracketView<G>(
  b: BracketRow,
  gameView: (g: typeof games.$inferSelect) => G | null,
  opts: { publicTeamNames: boolean },
): Promise<Omit<PublicBracket, 'matchups'> & { status: string; version: number; entrants: number; matchups: (Omit<PublicBracket['matchups'][number], 'game'> & { game: G | null; gameId: string | null })[] }> {
  const g = await loadGraph(db, b.id);
  const rounds = await db.select().from(bracketRounds).where(eq(bracketRounds.bracketId, b.id)).orderBy(asc(bracketRounds.roundNumber));
  const [division] = await db.select({ name: divisions.name }).from(divisions).where(eq(divisions.id, b.divisionId));
  const teamIds = [...new Set(g.slots.map((s) => s.teamId).filter((x): x is string => !!x))];
  const teamRows = teamIds.length ? await db.select({ id: teams.id, name: teams.name, city: teams.city, state: teams.state }).from(teams).where(inArray(teams.id, teamIds)) : [];
  const teamMap = new Map(teamRows.map((t, i) => [t.id, opts.publicTeamNames ? t : { id: t.id, name: `Team ${i + 1}`, city: null, state: null }]));
  return {
    id: b.id,
    divisionId: b.divisionId,
    divisionName: division?.name ?? '',
    name: b.name,
    size: b.size,
    entrants: b.entrants,
    status: b.status,
    version: b.version,
    rounds: rounds.map((r) => ({ round: r.roundNumber, name: r.name })),
    publishedAt: b.publishedAt?.toISOString() ?? null,
    updatedAt: b.updatedAt.toISOString(),
    matchups: await Promise.all(
      g.matchups.map(async (m) => {
        const ph = await placeholders(db, m.id);
        const slotFor = (p: SlotPosition) => {
          const s = g.slots.find((x) => x.matchupId === m.id && x.position === p)!;
          return { id: s.id, position: p, seed: s.seed, isBye: s.isBye, team: s.teamId ? (teamMap.get(s.teamId) ?? null) : null, placeholder: s.isBye ? 'Bye' : ph[p] };
        };
        const edge = g.edges.find((e) => e.fromMatchupId === m.id);
        const game = g.games.find((x) => x.bracketMatchupId === m.id);
        return {
          id: m.id,
          round: m.roundNumber,
          position: m.position,
          slots: [slotFor('top'), slotFor('bottom')] as [ReturnType<typeof slotFor>, ReturnType<typeof slotFor>],
          game: game ? gameView(game) : null,
          gameId: game?.id ?? null,
          winnerSlot: m.winnerSlot,
          advancesTo: edge ? { matchupId: edge.toMatchupId, slot: edge.toSlot } : null,
        };
      }),
    ),
  };
}
