import {
  CAPACITY_HOLDING_STATUSES,
  TOURNAMENT_TRANSITIONS,
  type AdminDivision,
  type AdminTournament,
  type DivisionInput,
  type TournamentInput,
  type TournamentStatus,
} from '@fd/shared';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { db } from '../db/client';
import { divisions, games, organizations, registrations, tournaments, tournamentVenues } from '../db/schema';
import { audit } from '../lib/audit';
import type { AuthedContext } from '../lib/context';
import { ApiError, notFound, versionConflict } from '../lib/errors';
import { uniqueViolation } from '../lib/pg';

type TournamentRow = typeof tournaments.$inferSelect;
type DivisionRow = typeof divisions.$inferSelect;

export function registrationState(t: Pick<TournamentRow, 'status' | 'registrationOpensAt' | 'registrationClosesAt'>, now = new Date()) {
  if (t.status !== 'published_open') return t.status === 'draft' ? ('not_yet_open' as const) : ('closed' as const);
  if (t.registrationOpensAt && now < t.registrationOpensAt) return 'not_yet_open' as const;
  if (t.registrationClosesAt && now >= t.registrationClosesAt) return 'closed' as const;
  return 'open' as const;
}

async function defaultOrganizationId(tx: DbOrTx) {
  const [org] = await tx.select({ id: organizations.id }).from(organizations).limit(1);
  if (org) return org.id;
  const [created] = await tx
    .insert(organizations)
    .values({ name: '5 Diamonds Tournament Baseball', slug: '5-diamonds' })
    .onConflictDoNothing()
    .returning({ id: organizations.id });
  if (created) return created.id;
  const [again] = await tx.select({ id: organizations.id }).from(organizations).limit(1);
  return again!.id;
}

const toRow = (d: TournamentInput) => ({
  title: d.title,
  slug: d.slug,
  startsOn: d.startsOn,
  endsOn: d.endsOn,
  region: d.region,
  category: d.category,
  summary: d.summary,
  description: d.description,
  registrationOpensAt: d.registrationOpensAt ? new Date(d.registrationOpensAt) : null,
  registrationClosesAt: d.registrationClosesAt ? new Date(d.registrationClosesAt) : null,
  rosterLocksAt: d.rosterLocksAt ? new Date(d.rosterLocksAt) : null,
  feeInfo: d.feeInfo,
  refundPolicyUrl: d.refundPolicyUrl,
  rulesText: d.rulesText,
  operationalContacts: d.operationalContacts,
  reviewMode: d.reviewMode,
  waitlistEnabled: d.waitlistEnabled,
  paymentRequired: d.paymentRequired,
  publicTeamNames: d.publicTeamNames,
  fieldBufferMinutes: d.fieldBufferMinutes,
  minTeamRestMinutes: d.minTeamRestMinutes,
});

export async function createTournament(ctx: AuthedContext, d: TournamentInput) {
  return db.transaction(async (tx) => {
    const organizationId = await defaultOrganizationId(tx);
    try {
      const [t] = await tx
        .insert(tournaments)
        .values({ ...toRow(d), organizationId, createdBy: ctx.user.id })
        .returning();
      await setVenues(tx, t!.id, d.venueIds);
      await audit(tx, ctx, { action: 'tournament.create', entityType: 'tournament', entityId: t!.id, tournamentId: t!.id, summary: d.title });
      return t!;
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError('CONFLICT', 'That URL slug is already in use.', { fields: { slug: 'Already in use' } });
      throw e;
    }
  });
}

async function setVenues(tx: DbOrTx, tournamentId: string, venueIds: string[]) {
  await tx.delete(tournamentVenues).where(eq(tournamentVenues.tournamentId, tournamentId));
  if (venueIds.length) {
    await tx.insert(tournamentVenues).values([...new Set(venueIds)].map((venueId) => ({ tournamentId, venueId })));
  }
}

export async function lockTournament(tx: DbOrTx, id: string) {
  const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, id)).for('update');
  if (!t) throw notFound('Tournament');
  return t;
}

export async function updateTournament(ctx: AuthedContext, id: string, version: number, d: TournamentInput) {
  return db.transaction(async (tx) => {
    const cur = await lockTournament(tx, id);
    if (cur.version !== version) throw versionConflict();
    // Review mode is fixed once registration opens (spec §7: configure before opening).
    if (cur.status !== 'draft' && cur.reviewMode !== d.reviewMode) {
      const [{ n }] = (await tx.select({ n: count() }).from(registrations).where(eq(registrations.tournamentId, id))) as [{ n: number }];
      if (n > 0) throw new ApiError('CONFLICT', 'Review mode cannot change after teams have registered.', { fields: { reviewMode: 'Locked' } });
    }
    try {
      const [t] = await tx
        .update(tournaments)
        .set({ ...toRow(d), version: cur.version + 1, updatedAt: new Date() })
        .where(eq(tournaments.id, id))
        .returning();
      await setVenues(tx, id, d.venueIds);
      await audit(tx, ctx, { action: 'tournament.update', entityType: 'tournament', entityId: id, tournamentId: id, data: { before: pick(cur), after: pick(t!) } });
      return t!;
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError('CONFLICT', 'That URL slug is already in use.', { fields: { slug: 'Already in use' } });
      throw e;
    }
  });
}

const pick = (t: TournamentRow) => ({ title: t.title, slug: t.slug, startsOn: t.startsOn, endsOn: t.endsOn, status: t.status, reviewMode: t.reviewMode });

export async function transitionTournament(ctx: AuthedContext, id: string, version: number, to: TournamentStatus, reason: string | null) {
  return db.transaction(async (tx) => {
    const cur = await lockTournament(tx, id);
    if (cur.version !== version) throw versionConflict();
    if (!TOURNAMENT_TRANSITIONS[cur.status].includes(to)) {
      throw new ApiError('INVALID_TRANSITION', `A tournament can't move from ${cur.status} to ${to}.`);
    }
    if (to === 'published_open') {
      const [{ n }] = (await tx.select({ n: count() }).from(divisions).where(eq(divisions.tournamentId, id))) as [{ n: number }];
      if (n === 0) throw new ApiError('INVALID_TRANSITION', 'Add at least one division before publishing.');
    }
    const isReversal = (cur.status === 'published_open' && to === 'draft') || (cur.status === 'completed' && to === 'in_progress') || (cur.status === 'canceled' && to === 'draft');
    if (isReversal && !reason) throw new ApiError('VALIDATION_FAILED', 'A reason is required to reverse a status change.', { fields: { reason: 'Required' } });
    if (to === 'canceled' && !reason) throw new ApiError('VALIDATION_FAILED', 'A reason is required to cancel a tournament.', { fields: { reason: 'Required' } });
    const [t] = await tx
      .update(tournaments)
      .set({
        status: to,
        version: cur.version + 1,
        updatedAt: new Date(),
        publishedAt: to === 'published_open' && !cur.publishedAt ? new Date() : cur.publishedAt,
      })
      .where(eq(tournaments.id, id))
      .returning();
    // Note: closing registration never touches existing registrations (spec §7).
    await audit(tx, ctx, { action: 'tournament.transition', entityType: 'tournament', entityId: id, tournamentId: id, reason, summary: `${cur.status} → ${to}` });
    return t!;
  });
}

// ---- Divisions -----------------------------------------------------------------------------

const divisionRow = (d: DivisionInput) => ({
  name: d.name,
  ageLabel: d.ageLabel,
  classification: d.classification,
  capacity: d.capacity,
  rosterMin: d.rosterMin,
  rosterMax: d.rosterMax,
  allowDuplicateJersey: d.allowDuplicateJersey,
  rulesText: d.rulesText,
  gameFormat: d.gameFormat,
  defaultGameMinutes: d.defaultGameMinutes,
  tiesAllowedInPool: d.tiesAllowedInPool,
  tiebreakers: d.tiebreakers,
  runDifferentialCap: d.runDifferentialCap,
  standingsSignedOff: d.standingsSignedOff,
  sortOrder: d.sortOrder,
});

export async function createDivision(ctx: AuthedContext, tournamentId: string, d: DivisionInput) {
  if (d.rosterMin !== null && d.rosterMax !== null && d.rosterMin > d.rosterMax) {
    throw new ApiError('VALIDATION_FAILED', 'Minimum roster size cannot exceed the maximum.', { fields: { rosterMin: 'Too large' } });
  }
  return db.transaction(async (tx) => {
    await lockTournament(tx, tournamentId);
    try {
      const [row] = await tx.insert(divisions).values({ ...divisionRow(d), tournamentId }).returning();
      await audit(tx, ctx, { action: 'division.create', entityType: 'division', entityId: row!.id, tournamentId, summary: d.name });
      return row!;
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError('CONFLICT', 'A division with that name already exists.', { fields: { name: 'Already exists' } });
      throw e;
    }
  });
}

export async function updateDivision(ctx: AuthedContext, divisionId: string, version: number, d: DivisionInput) {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(divisions).where(eq(divisions.id, divisionId)).for('update');
    if (!cur) throw notFound('Division');
    if (cur.version !== version) throw versionConflict();
    const held = await heldSpots(tx, divisionId);
    if (d.capacity < held) {
      throw new ApiError('CONFLICT', `Capacity can't go below the ${held} teams already holding spots.`, { fields: { capacity: `Minimum ${held}` } });
    }
    const [row] = await tx
      .update(divisions)
      .set({ ...divisionRow(d), version: cur.version + 1, updatedAt: new Date() })
      .where(eq(divisions.id, divisionId))
      .returning();
    await audit(tx, ctx, {
      action: 'division.update',
      entityType: 'division',
      entityId: divisionId,
      tournamentId: cur.tournamentId,
      data: { before: { capacity: cur.capacity, tiebreakers: cur.tiebreakers, signedOff: cur.standingsSignedOff }, after: { capacity: d.capacity, tiebreakers: d.tiebreakers, signedOff: d.standingsSignedOff } },
    });
    return row!;
  });
}

export async function deleteDivision(ctx: AuthedContext, divisionId: string) {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(divisions).where(eq(divisions.id, divisionId)).for('update');
    if (!cur) throw notFound('Division');
    const [{ n }] = (await tx.select({ n: count() }).from(registrations).where(eq(registrations.divisionId, divisionId))) as [{ n: number }];
    const [{ g }] = (await tx.select({ g: count() }).from(games).where(eq(games.divisionId, divisionId))) as [{ g: number }];
    if (n > 0 || g > 0) throw new ApiError('CONFLICT', 'This division has registrations or games and cannot be deleted.');
    await tx.delete(divisions).where(eq(divisions.id, divisionId));
    await audit(tx, ctx, { action: 'division.delete', entityType: 'division', entityId: divisionId, tournamentId: cur.tournamentId, summary: cur.name });
  });
}

export async function heldSpots(tx: DbOrTx, divisionId: string) {
  const [r] = await tx
    .select({ n: count() })
    .from(registrations)
    .where(and(eq(registrations.divisionId, divisionId), inArray(registrations.status, [...CAPACITY_HOLDING_STATUSES])));
  return Number(r?.n ?? 0);
}

/** Per-division held/waitlisted counts in one query. */
export async function divisionCounts(tx: DbOrTx, divisionIds: string[]) {
  if (!divisionIds.length) return new Map<string, { held: number; waitlisted: number }>();
  const rows = await tx
    .select({
      divisionId: registrations.divisionId,
      held: sql<number>`count(*) filter (where ${registrations.status} in ('pending_review','confirmed'))`.mapWith(Number),
      waitlisted: sql<number>`count(*) filter (where ${registrations.status} = 'waitlisted')`.mapWith(Number),
    })
    .from(registrations)
    .where(inArray(registrations.divisionId, divisionIds))
    .groupBy(registrations.divisionId);
  return new Map(rows.map((r) => [r.divisionId, { held: r.held, waitlisted: r.waitlisted }]));
}

export function toAdminDivision(d: DivisionRow, c?: { held: number; waitlisted: number }): AdminDivision {
  return {
    id: d.id,
    name: d.name,
    ageLabel: d.ageLabel,
    classification: d.classification,
    capacity: d.capacity,
    rosterMin: d.rosterMin,
    rosterMax: d.rosterMax,
    allowDuplicateJersey: d.allowDuplicateJersey,
    rulesText: d.rulesText,
    gameFormat: d.gameFormat,
    defaultGameMinutes: d.defaultGameMinutes,
    tiesAllowedInPool: d.tiesAllowedInPool,
    tiebreakers: d.tiebreakers,
    runDifferentialCap: d.runDifferentialCap,
    standingsSignedOff: d.standingsSignedOff,
    sortOrder: d.sortOrder,
    version: d.version,
    heldSpots: c?.held ?? 0,
    waitlisted: c?.waitlisted ?? 0,
  };
}

export async function getAdminTournament(id: string): Promise<AdminTournament> {
  const [t] = await db.select().from(tournaments).where(eq(tournaments.id, id));
  if (!t) throw notFound('Tournament');
  const divs = await db.select().from(divisions).where(eq(divisions.tournamentId, id)).orderBy(asc(divisions.sortOrder), asc(divisions.name));
  const counts = await divisionCounts(db, divs.map((d) => d.id));
  const venueRows = await db.select({ venueId: tournamentVenues.venueId }).from(tournamentVenues).where(eq(tournamentVenues.tournamentId, id));
  const [regCounts] = await db
    .select({
      confirmed: sql<number>`count(*) filter (where ${registrations.status} = 'confirmed')`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${registrations.status} = 'pending_review')`.mapWith(Number),
      waitlisted: sql<number>`count(*) filter (where ${registrations.status} = 'waitlisted')`.mapWith(Number),
    })
    .from(registrations)
    .where(eq(registrations.tournamentId, id));
  const [gameCounts] = await db
    .select({
      games: sql<number>`count(*) filter (where ${games.deletedAt} is null)`.mapWith(Number),
      unpublished: sql<number>`count(*) filter (where (${games.deletedAt} is null and (${games.published} is null or ${games.updatedAt} > ${games.publishedAt})) or (${games.deletedAt} is not null and ${games.published} is not null))`.mapWith(Number),
    })
    .from(games)
    .where(eq(games.tournamentId, id));
  return {
    ...serializeTournament(t),
    venueIds: venueRows.map((v) => v.venueId),
    divisions: divs.map((d) => toAdminDivision(d, counts.get(d.id))),
    counts: {
      confirmed: regCounts?.confirmed ?? 0,
      pending: regCounts?.pending ?? 0,
      waitlisted: regCounts?.waitlisted ?? 0,
      games: gameCounts?.games ?? 0,
      unpublishedGameChanges: gameCounts?.unpublished ?? 0,
    },
  };
}

export function serializeTournament(t: TournamentRow) {
  return {
    id: t.id,
    slug: t.slug,
    title: t.title,
    status: t.status,
    startsOn: t.startsOn,
    endsOn: t.endsOn,
    region: t.region,
    category: t.category,
    summary: t.summary,
    description: t.description,
    registrationOpensAt: t.registrationOpensAt?.toISOString() ?? null,
    registrationClosesAt: t.registrationClosesAt?.toISOString() ?? null,
    rosterLocksAt: t.rosterLocksAt?.toISOString() ?? null,
    feeInfo: t.feeInfo,
    refundPolicyUrl: t.refundPolicyUrl,
    rulesText: t.rulesText,
    operationalContacts: t.operationalContacts,
    reviewMode: t.reviewMode,
    waitlistEnabled: t.waitlistEnabled,
    paymentRequired: t.paymentRequired,
    publicTeamNames: t.publicTeamNames,
    fieldBufferMinutes: t.fieldBufferMinutes,
    minTeamRestMinutes: t.minTeamRestMinutes,
    isDemo: t.isDemo,
    version: t.version,
    publishedAt: t.publishedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function listAdminTournaments(scope: 'all' | string[]) {
  if (scope !== 'all' && scope.length === 0) return [];
  const rows = await db
    .select()
    .from(tournaments)
    .where(scope === 'all' ? undefined : inArray(tournaments.id, scope))
    .orderBy(sql`${tournaments.startsOn} desc`);
  return rows.map(serializeTournament);
}

