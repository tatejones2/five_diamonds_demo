// Game-day operations (spec §9.6, §10): status, scores, finalization, live reschedules and
// bracket advancement. Only confirmed finals advance winners; corrections never cascade silently.
import {
  downstreamOf,
  easternDateKey,
  easternTimeKey,
  easternWallTimeToUtc,
  validateResult,
  winnerSide,
  type GameResultType,
  type GameStatus,
} from '@fd/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { db } from '../db/client';
import { bracketAdvancementEdges, bracketMatchups, bracketSlots, divisions, games, gameVersions, tournaments } from '../db/schema';
import { audit } from '../lib/audit';
import type { AuthedContext } from '../lib/context';
import { ApiError, forbidden, notFound, versionConflict } from '../lib/errors';
import { canManageTournament, canScoreGame } from '../lib/policy';
import { placeWinner, syncMatchupGame } from './brackets';
import { serializeAdminGame, toProjection, validateLiveReschedule, type GameRow } from './schedule';

export interface GameUpdateInput {
  version: number;
  status: GameStatus;
  resultType: GameResultType;
  homeScore: number | null;
  awayScore: number | null;
  forfeitWinner: 'home' | 'away' | null;
  fieldId?: string | null;
  date?: string | null;
  time?: string | null;
  reason: string | null;
  downstreamResolution?: 'reset_downstream' | 'keep_downstream';
}

const isStarted = (g: GameRow) =>
  g.status === 'final' || g.status === 'in_progress' || g.status === 'suspended' || g.homeScore !== null || g.awayScore !== null;

export async function loadGameForStaff(ctx: AuthedContext, gameId: string, tx: DbOrTx = db) {
  const [g] = await tx.select().from(games).where(eq(games.id, gameId));
  if (!g || g.deletedAt) throw notFound('Game');
  if (!(await canScoreGame(tx, ctx, g))) throw forbidden('You are not assigned to this game.');
  return g;
}

export async function updateGame(ctx: AuthedContext, gameId: string, input: GameUpdateInput) {
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(games).where(eq(games.id, gameId)).for('update');
    if (!g || g.deletedAt) throw notFound('Game');
    if (!(await canScoreGame(tx, ctx, g))) throw forbidden('You are not assigned to this game.');
    if (g.version !== input.version) throw versionConflict();
    const isDirector = canManageTournament(ctx, g.tournamentId);
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, g.tournamentId));
    const [division] = await tx.select().from(divisions).where(eq(divisions.id, g.divisionId));

    // ---- Normalize & validate result
    const next = {
      status: input.status,
      resultType: input.status === 'final' ? input.resultType : ('played' as const),
      homeScore: input.resultType === 'forfeit' && input.status === 'final' ? null : input.homeScore,
      awayScore: input.resultType === 'forfeit' && input.status === 'final' ? null : input.awayScore,
      forfeitWinner: input.status === 'final' && input.resultType === 'forfeit' ? input.forfeitWinner : null,
    };
    if (next.status === 'final' && (!g.homeTeamId || !g.awayTeamId)) {
      throw new ApiError('VALIDATION_FAILED', 'Both teams must be set before this game can be final.');
    }
    const tiesAllowed = g.stage === 'bracket' ? false : !!division?.tiesAllowedInPool;
    const problems = validateResult(next, { tiesAllowed });
    if (problems.length) {
      throw new ApiError('VALIDATION_FAILED', problems[0]!.message, { fields: Object.fromEntries(problems.map((p) => [p.field, p.message])) });
    }

    const resultChanged =
      g.status !== next.status || g.resultType !== next.resultType || g.homeScore !== next.homeScore || g.awayScore !== next.awayScore || g.forfeitWinner !== next.forfeitWinner;
    const isCorrection = g.status === 'final' && resultChanged;
    if (isCorrection && !isDirector) throw forbidden('Only a tournament director can change a final result.');
    if (isCorrection && !input.reason) {
      throw new ApiError('VALIDATION_FAILED', 'Give a reason for correcting a final result.', { fields: { reason: 'Required for corrections' } });
    }

    // ---- Reschedule (director only)
    const wantsReschedule = input.fieldId !== undefined || input.date !== undefined || input.time !== undefined;
    let schedulePatch: { fieldId?: string | null; startsAt?: Date | null } = {};
    if (wantsReschedule) {
      if (!isDirector) throw forbidden('Only a tournament director can move a game.');
      const date = input.date !== undefined ? input.date : g.startsAt ? easternDateKey(g.startsAt) : null;
      const time = input.time !== undefined ? input.time : g.startsAt ? easternTimeKey(g.startsAt) : null;
      schedulePatch = {
        fieldId: input.fieldId !== undefined ? input.fieldId : g.fieldId,
        startsAt: date && time ? easternWallTimeToUtc(date, time) : null,
      };
      const moved = schedulePatch.fieldId !== g.fieldId || schedulePatch.startsAt?.getTime() !== g.startsAt?.getTime();
      if (!moved) schedulePatch = {};
      else if (g.published && !input.reason) {
        throw new ApiError('VALIDATION_FAILED', 'Give a reason for moving a published game (shown in the update history).', { fields: { reason: 'Required' } });
      }
    }

    // ---- Bracket propagation
    let bracketNote: string | null = null;
    if (g.bracketMatchupId) {
      const prevSide = winnerSide({ status: g.status, resultType: g.resultType, homeScore: g.homeScore, awayScore: g.awayScore, forfeitWinner: g.forfeitWinner });
      const nextSide = winnerSide(next);
      if (prevSide !== nextSide) {
        bracketNote = await propagate(tx, ctx, g, prevSide, nextSide, input, isDirector);
      }
    }

    const now = new Date();
    const becameFinal = next.status === 'final' && g.status !== 'final';
    const [updated] = await tx
      .update(games)
      .set({
        ...next,
        ...schedulePatch,
        finalizedAt: next.status === 'final' ? (becameFinal ? now : g.finalizedAt) : null,
        finalizedBy: next.status === 'final' ? (becameFinal ? ctx.user.id : g.finalizedBy) : null,
        version: g.version + 1,
        updatedAt: now,
      })
      .where(eq(games.id, g.id))
      .returning();

    if (Object.keys(schedulePatch).length && g.published) {
      const issues = await validateLiveReschedule(tx, t!, updated!);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length) throw new ApiError('SCHEDULE_INVALID', errors[0]!.message, { issues });
    }
    // Operational changes on a published game go live on save (ADR-007).
    if (g.published) {
      const live = { ...g.published, ...next, ...(schedulePatch.fieldId !== undefined ? { fieldId: schedulePatch.fieldId } : {}), ...(schedulePatch.startsAt !== undefined ? { startsAt: schedulePatch.startsAt?.toISOString() ?? null } : {}) };
      // Keep bracket-synced teams from the latest row.
      live.homeTeamId = updated!.homeTeamId;
      live.awayTeamId = updated!.awayTeamId;
      live.homePlaceholder = updated!.homePlaceholder;
      live.awayPlaceholder = updated!.awayPlaceholder;
      await tx.update(games).set({ published: live, publishedAt: now }).where(eq(games.id, g.id));
    }
    const kind = isCorrection ? 'correction' : next.status === 'final' ? 'result' : 'operational';
    await tx.insert(gameVersions).values({ gameId: g.id, kind, snapshot: toProjection(updated!), actorUserId: ctx.user.id, reason: input.reason });
    await audit(tx, ctx, {
      action: isCorrection ? 'game.correct_final' : becameFinal ? 'game.finalize' : 'game.update',
      entityType: 'game',
      entityId: g.id,
      tournamentId: g.tournamentId,
      reason: input.reason,
      summary: [describe(g), '→', describe(updated!), bracketNote].filter(Boolean).join(' '),
      data: { before: toProjection(g), after: toProjection(updated!) },
    });
    const [fresh] = await tx.select().from(games).where(eq(games.id, g.id));
    return serializeAdminGame(fresh!);
  });
}

const describe = (g: GameRow) =>
  `${g.status}${g.status === 'final' && g.resultType === 'forfeit' ? ` (forfeit, ${g.forfeitWinner} wins)` : g.homeScore !== null || g.awayScore !== null ? ` ${g.homeScore ?? '-'}-${g.awayScore ?? '-'}` : ''}`;

/**
 * Apply a winner change for a bracket game. If any downstream game has started, require an
 * explicit director decision (spec §10, §16 director test 6).
 */
async function propagate(
  tx: DbOrTx,
  ctx: AuthedContext,
  g: GameRow,
  prevSide: 'home' | 'away' | null,
  nextSide: 'home' | 'away' | null,
  input: GameUpdateInput,
  isDirector: boolean,
): Promise<string | null> {
  const [m] = await tx.select().from(bracketMatchups).where(eq(bracketMatchups.id, g.bracketMatchupId!)).for('update');
  if (!m) return null;
  const edges = await tx.select().from(bracketAdvancementEdges).where(eq(bracketAdvancementEdges.bracketId, m.bracketId));
  const chain = downstreamOf(m.id, edges);
  const chainIds = chain.map((c) => c.matchupId);
  const downstreamGames = chainIds.length
    ? (await tx.select().from(games).where(inArray(games.bracketMatchupId, chainIds)).for('update')).filter((x) => !x.deletedAt)
    : [];
  const startedDownstream = downstreamGames.filter(isStarted);
  const nextTeam = nextSide === 'home' ? g.homeTeamId : nextSide === 'away' ? g.awayTeamId : null;
  const winnerSlot = nextSide === 'home' ? 'top' : nextSide === 'away' ? 'bottom' : null;

  if (prevSide !== null && startedDownstream.length) {
    if (!input.downstreamResolution) {
      throw new ApiError(
        'DOWNSTREAM_CONFLICT',
        'Changing this result affects later bracket games that already have results. Choose how to resolve it.',
        {
          impacted: startedDownstream.map((d) => ({ gameId: d.id, label: d.label, status: d.status, homeScore: d.homeScore, awayScore: d.awayScore })),
          options: ['reset_downstream', 'keep_downstream'],
        },
      );
    }
    if (!isDirector) throw forbidden('Only a tournament director can resolve bracket conflicts.');
    if (input.downstreamResolution === 'keep_downstream') {
      // Director keeps later results as played; the advanced team stays as an explicit override.
      await tx.update(bracketMatchups).set({ winnerSlot }).where(eq(bracketMatchups.id, m.id));
      const first = chain[0]!;
      await tx.update(bracketSlots).set({ filledBy: 'override' }).where(and(eq(bracketSlots.matchupId, first.matchupId), eq(bracketSlots.position, first.viaSlot)));
      await audit(tx, ctx, { action: 'bracket.keep_downstream', entityType: 'game', entityId: g.id, tournamentId: g.tournamentId, reason: input.reason, summary: `Kept ${startedDownstream.length} downstream result(s)` });
      return `(kept ${startedDownstream.length} downstream result(s) by director override)`;
    }
    // reset_downstream: clear later results along the chain, then re-advance.
    const now = new Date();
    for (const d of downstreamGames) {
      if (!isStarted(d)) continue;
      const [reset] = await tx
        .update(games)
        .set({ status: 'scheduled', resultType: 'played', homeScore: null, awayScore: null, forfeitWinner: null, finalizedAt: null, finalizedBy: null, version: d.version + 1, updatedAt: now })
        .where(eq(games.id, d.id))
        .returning();
      if (d.published) {
        await tx
          .update(games)
          .set({ published: { ...d.published, status: 'scheduled', resultType: 'played', homeScore: null, awayScore: null, forfeitWinner: null }, publishedAt: now })
          .where(eq(games.id, d.id));
      }
      await tx.insert(gameVersions).values({ gameId: d.id, kind: 'bracket_reset', snapshot: toProjection(reset!), actorUserId: ctx.user.id, reason: input.reason });
    }
    await tx.update(bracketMatchups).set({ winnerSlot: null }).where(inArray(bracketMatchups.id, chainIds));
    for (const c of chain.slice(1)) {
      await tx.update(bracketSlots).set({ teamId: null, filledBy: null }).where(and(eq(bracketSlots.matchupId, c.matchupId), eq(bracketSlots.position, c.viaSlot)));
      await syncMatchupGame(tx, ctx, c.matchupId, input.reason);
    }
    await tx.update(bracketMatchups).set({ winnerSlot }).where(eq(bracketMatchups.id, m.id));
    await placeWinner(tx, ctx, edges, m.id, nextTeam, 'advancement', input.reason);
    await audit(tx, ctx, { action: 'bracket.reset_downstream', entityType: 'game', entityId: g.id, tournamentId: g.tournamentId, reason: input.reason, summary: `Reset ${startedDownstream.length} downstream result(s)` });
    return `(reset ${startedDownstream.length} downstream result(s))`;
  }

  await tx.update(bracketMatchups).set({ winnerSlot }).where(eq(bracketMatchups.id, m.id));
  await placeWinner(tx, ctx, edges, m.id, nextTeam, 'advancement', nextTeam ? 'Winner advanced' : 'Result reopened');
  return nextTeam ? '(winner advanced)' : '(advancement cleared)';
}

export async function gameHistory(gameId: string) {
  return db.select().from(gameVersions).where(eq(gameVersions.gameId, gameId)).orderBy(gameVersions.createdAt);
}
