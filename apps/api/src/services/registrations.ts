import {
  ACTIVE_REGISTRATION_STATUSES,
  CAPACITY_HOLDING_STATUSES,
  REGISTRATION_TRANSITIONS,
  STATUS_LABELS,
  type AdminRegistrationDto,
  type PaymentStatus,
  type RegistrationDto,
  type RegistrationStatus,
} from '@fd/shared';
import { randomInt } from 'node:crypto';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { db } from '../db/client';
import {
  divisions,
  notificationPreferences,
  paymentEvents,
  registrations,
  registrationStatusEvents,
  teamRosterEntries,
  teams,
  tournamentRosterSnapshots,
  tournaments,
  user,
} from '../db/schema';
import { audit } from '../lib/audit';
import type { AuthedContext } from '../lib/context';
import { ApiError, notFound, versionConflict } from '../lib/errors';
import { uniqueViolation } from '../lib/pg';
import { loadOwnTeam } from '../lib/policy';
import { enqueueEmail } from './mailer';
import { currentRosterEntries, writeSnapshot } from './teams';
import { registrationState } from './tournaments';
import { config } from '../config';

const CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679'; // no 0/O, 1/I/L, 2/Z, 5/S, 8/B
const referenceCode = () => '5D-' + Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

export interface CreateRegistrationResult {
  registration: RegistrationDto;
  outcome: 'confirmed' | 'pending_review' | 'waitlisted';
}

export async function createRegistration(
  ctx: AuthedContext,
  input: { divisionId: string; teamId: string; joinWaitlistIfFull: boolean },
): Promise<CreateRegistrationResult> {
  const id = await db.transaction(async (tx) => {
    // Lock order: division → team. Every writer that changes capacity locks the division first.
    const [division] = await tx.select().from(divisions).where(eq(divisions.id, input.divisionId)).for('update');
    if (!division) throw notFound('Division');
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, division.tournamentId));
    if (!t || t.status === 'draft') throw notFound('Division');
    const state = registrationState(t);
    if (state !== 'open') {
      throw new ApiError('REGISTRATION_CLOSED', state === 'not_yet_open' ? 'Registration for this tournament has not opened yet.' : 'Registration for this tournament is closed.');
    }
    const team = await loadOwnTeam(tx, ctx, input.teamId, { forUpdate: true });

    const [dup] = await tx
      .select({ id: registrations.id, status: registrations.status })
      .from(registrations)
      .where(and(eq(registrations.divisionId, division.id), eq(registrations.teamId, team.id), inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES])));
    if (dup) {
      throw new ApiError('DUPLICATE_REGISTRATION', `${team.name} is already registered in this division (${STATUS_LABELS.registration[dup.status]}).`, { registrationId: dup.id });
    }

    const [held] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(registrations)
      .where(and(eq(registrations.divisionId, division.id), inArray(registrations.status, [...CAPACITY_HOLDING_STATUSES])));
    const hasSpace = (held?.n ?? 0) < division.capacity;

    let status: RegistrationStatus;
    if (hasSpace) status = t.reviewMode === 'auto_confirm' ? 'confirmed' : 'pending_review';
    else if (t.waitlistEnabled && input.joinWaitlistIfFull) status = 'waitlisted';
    else {
      throw new ApiError('CAPACITY_FULL', t.waitlistEnabled ? 'This division just filled up. You can join the waitlist instead.' : 'This division is full.', {
        waitlistAvailable: t.waitlistEnabled,
      });
    }

    let row: typeof registrations.$inferSelect | undefined;
    for (let attempt = 0; attempt < 5 && !row; attempt++) {
      try {
        [row] = await tx
          .insert(registrations)
          .values({
            referenceCode: referenceCode(),
            tournamentId: t.id,
            divisionId: division.id,
            teamId: team.id,
            submittedBy: ctx.user.id,
            status,
            paymentStatus: t.paymentRequired ? 'not_started' : 'not_required',
            waitlistedAt: status === 'waitlisted' ? new Date() : null,
          })
          .returning();
      } catch (e) {
        if (uniqueViolation(e, 'registrations_active_unique')) {
          throw new ApiError('DUPLICATE_REGISTRATION', `${team.name} is already registered in this division.`);
        }
        if (!uniqueViolation(e)) throw e; // reference code collision → retry
      }
    }
    if (!row) throw new ApiError('INTERNAL', 'Could not allocate a reference number. Please try again.');

    await tx.insert(registrationStatusEvents).values([
      { registrationId: row.id, fromStatus: null, toStatus: 'submitted', actorUserId: ctx.user.id },
      { registrationId: row.id, fromStatus: 'submitted', toStatus: status, actorUserId: null, reason: autoReason(status) },
    ]);
    await writeSnapshot(tx, row.id, await currentRosterEntries(tx, team.id), ctx.user.id, 'Submitted with registration');
    return row.id;
  });

  const registration = await getRegistrationDto(id);
  await notifyRegistration(ctx.user.id, ctx.user.email, registration).catch(() => {});
  return { registration, outcome: registration.status as CreateRegistrationResult['outcome'] };
}

const autoReason = (s: RegistrationStatus) =>
  s === 'confirmed' ? 'Spot available; tournament auto-confirms registrations.' : s === 'pending_review' ? 'Spot held pending director review.' : 'Division full; added to waitlist.';

async function notifyRegistration(userId: string, email: string, r: RegistrationDto) {
  const [pref] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  if (pref && !pref.emailRegistrationUpdates) return;
  await enqueueEmail({
    to: email,
    userId,
    template: 'registration_status',
    idempotencyKey: `registration:${r.id}:${r.status}:${r.version}`,
    subject: `${r.team.name}: ${STATUS_LABELS.registration[r.status]} — ${r.tournament.title}`,
    text: [
      `Registration ${r.referenceCode}`,
      `Team: ${r.team.name}`,
      `Tournament: ${r.tournament.title} (${r.division.name})`,
      `Status: ${STATUS_LABELS.registration[r.status]}`,
      '',
      `View details: ${config.APP_ORIGIN}/dashboard/registrations/${r.id}`,
    ].join('\n'),
  });
}

// ---- Reads ----------------------------------------------------------------------------------

const baseSelect = {
  r: registrations,
  teamName: teams.name,
  ownerUserId: teams.ownerUserId,
  tSlug: tournaments.slug,
  tTitle: tournaments.title,
  tStartsOn: tournaments.startsOn,
  tEndsOn: tournaments.endsOn,
  tRosterLocksAt: tournaments.rosterLocksAt,
  dName: divisions.name,
  dAge: divisions.ageLabel,
};

function baseQuery(tx: DbOrTx) {
  return tx
    .select(baseSelect)
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .innerJoin(tournaments, eq(tournaments.id, registrations.tournamentId))
    .innerJoin(divisions, eq(divisions.id, registrations.divisionId));
}

type BaseRow = Awaited<ReturnType<typeof baseQuery>>[number];

async function waitlistPosition(tx: DbOrTx, r: typeof registrations.$inferSelect) {
  if (r.status !== 'waitlisted' || !r.waitlistedAt) return null;
  const [p] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(registrations)
    .where(and(eq(registrations.divisionId, r.divisionId), eq(registrations.status, 'waitlisted'), sql`${registrations.waitlistedAt} <= ${r.waitlistedAt}`));
  return p?.n ?? null;
}

async function hydrate(tx: DbOrTx, row: BaseRow): Promise<RegistrationDto> {
  const events = await tx
    .select()
    .from(registrationStatusEvents)
    .where(eq(registrationStatusEvents.registrationId, row.r.id))
    .orderBy(asc(registrationStatusEvents.seq));
  const [snap] = await tx
    .select()
    .from(tournamentRosterSnapshots)
    .where(eq(tournamentRosterSnapshots.registrationId, row.r.id))
    .orderBy(desc(tournamentRosterSnapshots.revision))
    .limit(1);
  return {
    id: row.r.id,
    referenceCode: row.r.referenceCode,
    status: row.r.status,
    paymentStatus: row.r.paymentStatus,
    team: { id: row.r.teamId, name: row.teamName },
    tournament: {
      id: row.r.tournamentId,
      slug: row.tSlug,
      title: row.tTitle,
      startsOn: row.tStartsOn,
      endsOn: row.tEndsOn,
      rosterLocksAt: row.tRosterLocksAt?.toISOString() ?? null,
    },
    division: { id: row.r.divisionId, name: row.dName, ageLabel: row.dAge },
    waitlistPosition: await waitlistPosition(tx, row.r),
    createdAt: row.r.createdAt.toISOString(),
    updatedAt: row.r.updatedAt.toISOString(),
    version: row.r.version,
    timeline: events.map((e) => ({ at: e.createdAt.toISOString(), from: e.fromStatus, to: e.toStatus, reason: e.reason, byStaff: e.byStaff })),
    latestSnapshot: snap
      ? { id: snap.id, registrationId: snap.registrationId, revision: snap.revision, entries: snap.entries, createdAt: snap.createdAt.toISOString(), reason: snap.reason }
      : null,
  };
}

export async function getRegistrationDto(id: string, tx: DbOrTx = db) {
  const [row] = await baseQuery(tx).where(eq(registrations.id, id));
  if (!row) throw notFound('Registration');
  return hydrate(tx, row);
}

export async function listMyRegistrations(ctx: AuthedContext) {
  const rows = await baseQuery(db).where(eq(teams.ownerUserId, ctx.user.id)).orderBy(desc(tournaments.startsOn), asc(teams.name));
  return Promise.all(rows.map((r) => hydrate(db, r)));
}

/** NOT_FOUND for other users' registrations: no existence leak (spec §15). */
export async function getMyRegistration(ctx: AuthedContext, id: string) {
  const [row] = await baseQuery(db).where(and(eq(registrations.id, id), eq(teams.ownerUserId, ctx.user.id)));
  if (!row) throw notFound('Registration');
  return hydrate(db, row);
}

export async function listTournamentRegistrations(tournamentId: string, filters: { status?: RegistrationStatus; q?: string; divisionId?: string }) {
  const conds = [eq(registrations.tournamentId, tournamentId)];
  if (filters.status) conds.push(eq(registrations.status, filters.status));
  if (filters.divisionId) conds.push(eq(registrations.divisionId, filters.divisionId));
  if (filters.q) {
    const q = `%${filters.q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    conds.push(or(ilike(teams.name, q), ilike(registrations.referenceCode, q), ilike(user.email, q))!);
  }
  const rows = await db
    .select({ ...baseSelect, managerName: user.name, managerEmail: user.email, rosterCount: sql<number>`(select count(*) from ${teamRosterEntries} where ${teamRosterEntries.teamId} = ${teams.id})`.mapWith(Number) })
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .innerJoin(tournaments, eq(tournaments.id, registrations.tournamentId))
    .innerJoin(divisions, eq(divisions.id, registrations.divisionId))
    .innerJoin(user, eq(user.id, teams.ownerUserId))
    .where(and(...conds))
    .orderBy(asc(divisions.sortOrder), asc(registrations.createdAt));
  return Promise.all(
    rows.map(async (r): Promise<AdminRegistrationDto> => ({
      ...(await hydrate(db, r)),
      manager: { id: r.ownerUserId, name: r.managerName, email: r.managerEmail },
      rosterCount: r.rosterCount,
      notes: r.r.staffNotes,
    })),
  );
}

// ---- Status changes ------------------------------------------------------------------------

export async function changeRegistrationStatus(
  ctx: AuthedContext,
  id: string,
  input: { version: number; to: RegistrationStatus; reason: string; overrideCapacity: boolean },
  opts: { byStaff: boolean },
) {
  const result = await db.transaction(async (tx) => {
    const [peek] = await tx.select({ divisionId: registrations.divisionId }).from(registrations).where(eq(registrations.id, id));
    if (!peek) throw notFound('Registration');
    const [division] = await tx.select().from(divisions).where(eq(divisions.id, peek.divisionId)).for('update');
    const [cur] = await tx.select().from(registrations).where(eq(registrations.id, id)).for('update');
    if (!cur || !division) throw notFound('Registration');
    if (cur.version !== input.version) throw versionConflict();
    if (!REGISTRATION_TRANSITIONS[cur.status].includes(input.to)) {
      throw new ApiError('INVALID_TRANSITION', `Can't change a registration from ${STATUS_LABELS.registration[cur.status]} to ${STATUS_LABELS.registration[input.to]}.`);
    }
    const entersCapacity = CAPACITY_HOLDING_STATUSES.includes(input.to) && !CAPACITY_HOLDING_STATUSES.includes(cur.status);
    if (entersCapacity) {
      const [held] = await tx
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(registrations)
        .where(and(eq(registrations.divisionId, division.id), inArray(registrations.status, [...CAPACITY_HOLDING_STATUSES])));
      if ((held?.n ?? 0) >= division.capacity) {
        if (!(opts.byStaff && input.overrideCapacity)) {
          throw new ApiError('CAPACITY_FULL', `${division.name} is full (${division.capacity} teams). Raise the capacity or confirm with an explicit override.`);
        }
        await audit(tx, ctx, { action: 'registration.capacity_override', entityType: 'registration', entityId: id, tournamentId: cur.tournamentId, reason: input.reason });
      }
    }
    const [row] = await tx
      .update(registrations)
      .set({
        status: input.to,
        version: cur.version + 1,
        updatedAt: new Date(),
        waitlistedAt: input.to === 'waitlisted' ? (cur.waitlistedAt ?? new Date()) : cur.waitlistedAt,
      })
      .where(eq(registrations.id, id))
      .returning();
    await tx.insert(registrationStatusEvents).values({
      registrationId: id,
      fromStatus: cur.status,
      toStatus: input.to,
      actorUserId: ctx.user.id,
      byStaff: opts.byStaff,
      reason: input.reason,
    });
    if (opts.byStaff) {
      await audit(tx, ctx, { action: 'registration.status', entityType: 'registration', entityId: id, tournamentId: cur.tournamentId, reason: input.reason, summary: `${cur.status} → ${input.to}` });
    }
    return row!;
  });
  const dto = await getRegistrationDto(result.id);
  const [owner] = await db.select({ id: user.id, email: user.email }).from(user).innerJoin(teams, eq(teams.ownerUserId, user.id)).where(eq(teams.id, dto.team.id));
  if (owner) await notifyRegistration(owner.id, owner.email, dto).catch(() => {});
  return dto;
}

/** Staff payment status changes. `paid_verified` is reserved for verified provider callbacks. */
export async function changePaymentStatus(ctx: AuthedContext, id: string, input: { version: number; to: PaymentStatus; reason: string; externalReference: string | null }) {
  if (input.to === 'paid_verified') {
    throw new ApiError('VALIDATION_FAILED', 'Only a verified payment provider callback can mark a registration "Paid (Verified)". Use "Paid (Verified by Staff)" for offline payments.');
  }
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(registrations).where(eq(registrations.id, id)).for('update');
    if (!cur) throw notFound('Registration');
    if (cur.version !== input.version) throw versionConflict();
    await tx.update(registrations).set({ paymentStatus: input.to, version: cur.version + 1, updatedAt: new Date() }).where(eq(registrations.id, id));
    await tx.insert(paymentEvents).values({
      registrationId: id,
      provider: 'staff',
      type: 'manual_status_change',
      verified: false,
      fromStatus: cur.paymentStatus,
      toStatus: input.to,
      actorUserId: ctx.user.id,
      reason: input.externalReference ? `${input.reason} (ref: ${input.externalReference})` : input.reason,
    });
    await audit(tx, ctx, { action: 'registration.payment_status', entityType: 'registration', entityId: id, tournamentId: cur.tournamentId, reason: input.reason, summary: `${cur.paymentStatus} → ${input.to}` });
    return getRegistrationDto(id, tx);
  });
}
