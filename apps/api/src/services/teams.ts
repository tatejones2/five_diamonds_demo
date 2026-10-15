import {
  ACTIVE_REGISTRATION_STATUSES,
  validateRoster,
  type ManagerTeam,
  type RosterDto,
  type RosterRules,
  type TeamInput,
} from '@fd/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { db } from '../db/client';
import { divisions, registrations, teamMemberships, teamRosterEntries, teams, tournamentRosterSnapshots, tournaments } from '../db/schema';
import { audit } from '../lib/audit';
import type { AuthedContext, RequestContext } from '../lib/context';
import { ApiError, notFound, versionConflict } from '../lib/errors';
import { loadOwnTeam } from '../lib/policy';

type TeamRow = typeof teams.$inferSelect;

const DEFAULT_RULES: RosterRules = { maxSize: 40, allowDuplicateJersey: false };

function serializeTeam(t: TeamRow, rosterCount: number, activeRegistrations: number): ManagerTeam {
  return {
    id: t.id,
    name: t.name,
    organizationName: t.organizationName,
    ageGroup: t.ageGroup,
    city: t.city,
    state: t.state,
    coachContactName: t.coachContactName,
    coachContactPhone: t.coachContactPhone,
    coachContactEmail: t.coachContactEmail,
    rosterCount,
    rosterVersion: t.rosterVersion,
    version: t.version,
    activeRegistrations,
    createdAt: t.createdAt.toISOString(),
  };
}

export async function listMyTeams(ctx: AuthedContext): Promise<ManagerTeam[]> {
  const rows = await db
    .select({
      team: teams,
      rosterCount: sql<number>`(select count(*) from ${teamRosterEntries} where ${teamRosterEntries.teamId} = ${teams.id})`.mapWith(Number),
      active: sql<number>`(select count(*) from ${registrations} where ${registrations.teamId} = ${teams.id} and ${registrations.status} in ('draft','submitted','pending_review','confirmed','waitlisted'))`.mapWith(Number),
    })
    .from(teams)
    .where(and(eq(teams.ownerUserId, ctx.user.id), sql`${teams.archivedAt} is null`))
    .orderBy(asc(teams.name));
  return rows.map((r) => serializeTeam(r.team, r.rosterCount, r.active));
}

export async function getMyTeam(ctx: AuthedContext, teamId: string) {
  const t = await loadOwnTeam(db, ctx, teamId);
  const [c] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(teamRosterEntries).where(eq(teamRosterEntries.teamId, teamId));
  const [a] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(registrations)
    .where(and(eq(registrations.teamId, teamId), inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES])));
  return serializeTeam(t, c?.n ?? 0, a?.n ?? 0);
}

const teamRow = (d: TeamInput) => ({
  name: d.name,
  organizationName: d.organizationName,
  ageGroup: d.ageGroup,
  city: d.city,
  state: d.state?.toUpperCase() ?? null,
  coachContactName: d.coachContactName,
  coachContactPhone: d.coachContactPhone,
  coachContactEmail: d.coachContactEmail,
});

export const MAX_TEAMS_PER_ACCOUNT = 25;

export async function createTeam(ctx: AuthedContext, d: TeamInput) {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(teams)
      .where(and(eq(teams.ownerUserId, ctx.user.id), sql`${teams.archivedAt} is null`));
    if ((c?.n ?? 0) >= MAX_TEAMS_PER_ACCOUNT) throw new ApiError('CONFLICT', `An account can manage up to ${MAX_TEAMS_PER_ACCOUNT} teams.`);
    const [t] = await tx.insert(teams).values({ ...teamRow(d), ownerUserId: ctx.user.id }).returning();
    await tx.insert(teamMemberships).values({ teamId: t!.id, userId: ctx.user.id, role: 'owner', acceptedAt: new Date() });
    return serializeTeam(t!, 0, 0);
  });
}

export async function updateTeam(ctx: AuthedContext, teamId: string, version: number, d: TeamInput) {
  return db.transaction(async (tx) => {
    const cur = await loadOwnTeam(tx, ctx, teamId, { forUpdate: true });
    if (cur.version !== version) throw versionConflict();
    const [t] = await tx.update(teams).set({ ...teamRow(d), version: cur.version + 1, updatedAt: new Date() }).where(eq(teams.id, teamId)).returning();
    return serializeTeam(t!, 0, 0);
  });
}

export async function archiveTeam(ctx: AuthedContext, teamId: string) {
  return db.transaction(async (tx) => {
    await loadOwnTeam(tx, ctx, teamId, { forUpdate: true });
    const [a] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(registrations)
      .where(and(eq(registrations.teamId, teamId), inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES])));
    if ((a?.n ?? 0) > 0) throw new ApiError('CONFLICT', 'Withdraw this team from its active registrations before removing it.');
    await tx.update(teams).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(teams.id, teamId));
  });
}

// ---- Rosters --------------------------------------------------------------------------------

/** Active registrations for a team with their lock state and division rules. */
async function activeRegistrationsWithLocks(tx: DbOrTx, teamId: string, now = new Date()) {
  const rows = await tx
    .select({
      registrationId: registrations.id,
      tournamentTitle: tournaments.title,
      rosterLocksAt: tournaments.rosterLocksAt,
      rosterMax: divisions.rosterMax,
      allowDuplicateJersey: divisions.allowDuplicateJersey,
    })
    .from(registrations)
    .innerJoin(tournaments, eq(tournaments.id, registrations.tournamentId))
    .innerJoin(divisions, eq(divisions.id, registrations.divisionId))
    .where(and(eq(registrations.teamId, teamId), inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES])));
  return rows.map((r) => ({ ...r, locked: !!r.rosterLocksAt && r.rosterLocksAt <= now }));
}

/** Strictest rules across the events this roster will feed (unlocked active registrations). */
function effectiveRules(regs: { locked: boolean; rosterMax: number | null; allowDuplicateJersey: boolean }[]): RosterRules {
  const open = regs.filter((r) => !r.locked);
  if (!open.length) return DEFAULT_RULES;
  const maxes = open.map((r) => r.rosterMax).filter((m): m is number => m !== null);
  return {
    maxSize: maxes.length ? Math.min(...maxes) : DEFAULT_RULES.maxSize,
    allowDuplicateJersey: open.every((r) => r.allowDuplicateJersey),
  };
}

export async function getRoster(teamId: string): Promise<RosterDto> {
  const [team] = await db.select({ rosterVersion: teams.rosterVersion }).from(teams).where(eq(teams.id, teamId));
  if (!team) throw notFound('Team');
  const entries = await db
    .select({ id: teamRosterEntries.id, playerName: teamRosterEntries.playerName, jerseyNumber: teamRosterEntries.jerseyNumber })
    .from(teamRosterEntries)
    .where(eq(teamRosterEntries.teamId, teamId))
    .orderBy(asc(teamRosterEntries.sortOrder), asc(teamRosterEntries.createdAt));
  const regs = await activeRegistrationsWithLocks(db, teamId);
  const locks = regs
    .filter((r) => r.locked)
    .map((r) => ({ registrationId: r.registrationId, tournamentTitle: r.tournamentTitle, lockedAt: r.rosterLocksAt!.toISOString() }));
  return { teamId, version: team.rosterVersion, entries, locks, isLocked: locks.length > 0 && locks.length === regs.length };
}

export async function getRosterRules(teamId: string) {
  return effectiveRules(await activeRegistrationsWithLocks(db, teamId));
}

/**
 * Replace a team roster atomically. Either every row is valid and committed, or nothing is
 * (spec §16 coach test 3: "no partial unexpected commits").
 * Snapshots are refreshed for unlocked registrations only; locked event rosters stay frozen.
 */
export async function replaceRoster(
  ctx: RequestContext & { user: { id: string } },
  teamId: string,
  version: number,
  entries: { playerName: string; jerseyNumber: string }[],
  opts: { staff: boolean; reason: string | null },
) {
  return db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for('update');
    if (!team) throw notFound('Team');
    if (team.rosterVersion !== version) throw versionConflict();
    const regs = await activeRegistrationsWithLocks(tx, teamId);
    const rules = effectiveRules(regs);
    const v = validateRoster(entries, rules);
    if (!v.valid) throw new ApiError('VALIDATION_FAILED', 'Fix the highlighted roster rows before saving.', { roster: v });

    await tx.delete(teamRosterEntries).where(eq(teamRosterEntries.teamId, teamId));
    const clean = v.rows.map((r, i) => ({ teamId, playerName: r.playerName, jerseyNumber: r.jerseyNumber, sortOrder: i }));
    if (clean.length) await tx.insert(teamRosterEntries).values(clean);
    await tx.update(teams).set({ rosterVersion: team.rosterVersion + 1, updatedAt: new Date() }).where(eq(teams.id, teamId));

    const snapshotEntries = clean.map((c) => ({ playerName: c.playerName, jerseyNumber: c.jerseyNumber }));
    const refreshed: string[] = [];
    for (const r of regs.filter((r) => !r.locked)) {
      await writeSnapshot(tx, r.registrationId, snapshotEntries, ctx.user.id, opts.reason);
      refreshed.push(r.registrationId);
    }
    if (opts.staff) {
      await audit(tx, ctx, { action: 'roster.staff_replace', entityType: 'team', entityId: teamId, reason: opts.reason, summary: `${clean.length} players` });
    }
    return {
      version: team.rosterVersion + 1,
      count: clean.length,
      refreshedRegistrations: refreshed,
      frozenRegistrations: regs.filter((r) => r.locked).map((r) => ({ registrationId: r.registrationId, tournamentTitle: r.tournamentTitle })),
      warnings: v.rows.flatMap((r) => r.warnings.map((w) => `Row ${r.index + 1}: ${w}`)),
    };
  });
}

export async function writeSnapshot(
  tx: DbOrTx,
  registrationId: string,
  entries: { playerName: string; jerseyNumber: string }[],
  actorId: string | null,
  reason: string | null,
) {
  const [last] = await tx
    .select({ revision: tournamentRosterSnapshots.revision })
    .from(tournamentRosterSnapshots)
    .where(eq(tournamentRosterSnapshots.registrationId, registrationId))
    .orderBy(desc(tournamentRosterSnapshots.revision))
    .limit(1);
  await tx.insert(tournamentRosterSnapshots).values({
    registrationId,
    revision: (last?.revision ?? 0) + 1,
    entries,
    createdBy: actorId,
    reason,
  });
}

export async function currentRosterEntries(tx: DbOrTx, teamId: string) {
  return tx
    .select({ playerName: teamRosterEntries.playerName, jerseyNumber: teamRosterEntries.jerseyNumber })
    .from(teamRosterEntries)
    .where(eq(teamRosterEntries.teamId, teamId))
    .orderBy(asc(teamRosterEntries.sortOrder));
}

/** Staff revision of a locked event roster (spec §8: authorized, logged revision). */
export async function staffReviseSnapshot(
  ctx: AuthedContext,
  registrationId: string,
  entries: { playerName: string; jerseyNumber: string }[],
  reason: string,
) {
  return db.transaction(async (tx) => {
    const [reg] = await tx
      .select({ id: registrations.id, tournamentId: registrations.tournamentId, divisionId: registrations.divisionId })
      .from(registrations)
      .where(eq(registrations.id, registrationId))
      .for('update');
    if (!reg) throw notFound('Registration');
    const [div] = await tx.select().from(divisions).where(eq(divisions.id, reg.divisionId));
    const v = validateRoster(entries, { maxSize: div?.rosterMax ?? DEFAULT_RULES.maxSize, allowDuplicateJersey: !!div?.allowDuplicateJersey });
    if (!v.valid) throw new ApiError('VALIDATION_FAILED', 'Fix the highlighted roster rows before saving.', { roster: v });
    const clean = v.rows.map((r) => ({ playerName: r.playerName, jerseyNumber: r.jerseyNumber }));
    await writeSnapshot(tx, registrationId, clean, ctx.user.id, reason);
    await audit(tx, ctx, { action: 'roster_snapshot.staff_revise', entityType: 'registration', entityId: registrationId, tournamentId: reg.tournamentId, reason, summary: `${clean.length} players` });
  });
}
