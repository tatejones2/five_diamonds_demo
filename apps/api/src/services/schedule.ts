// Native schedule builder (spec §9): draft edits → validate → preview → publish.
import {
  easternDateKey,
  easternTimeKey,
  easternWallTimeToUtc,
  hasBlockingIssues,
  validateSchedule,
  type AdminGame,
  type GameDraftInput,
  type RegistrationStatus,
  type ScheduleGame,
  type ScheduleIssue,
} from '@fd/shared';
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { db } from '../db/client';
import {
  divisions,
  fields,
  games,
  gameVersions,
  registrations,
  scheduleVersions,
  tournaments,
  tournamentVenues,
  type PublishedGameProjection,
} from '../db/schema';
import { audit } from '../lib/audit';
import type { AuthedContext } from '../lib/context';
import { ApiError, notFound, versionConflict } from '../lib/errors';
import { lockTournament } from './tournaments';

export type GameRow = typeof games.$inferSelect;

export function toProjection(g: GameRow): PublishedGameProjection {
  return {
    divisionId: g.divisionId,
    stage: g.stage,
    poolLabel: g.poolLabel,
    label: g.label,
    fieldId: g.fieldId,
    startsAt: g.startsAt?.toISOString() ?? null,
    durationMinutes: g.durationMinutes,
    homeTeamId: g.homeTeamId,
    awayTeamId: g.awayTeamId,
    homePlaceholder: g.homePlaceholder,
    awayPlaceholder: g.awayPlaceholder,
    status: g.status,
    resultType: g.resultType,
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    forfeitWinner: g.forfeitWinner,
    bracketMatchupId: g.bracketMatchupId,
  };
}

const SCHEDULE_FIELDS = ['divisionId', 'stage', 'poolLabel', 'label', 'fieldId', 'startsAt', 'durationMinutes', 'homeTeamId', 'awayTeamId', 'homePlaceholder', 'awayPlaceholder', 'status'] as const;

function scheduleKey(p: PublishedGameProjection) {
  return SCHEDULE_FIELDS.map((f) => p[f] ?? '').join('|');
}

export function serializeAdminGame(g: GameRow): AdminGame {
  const proj = toProjection(g);
  return {
    id: g.id,
    version: g.version,
    divisionId: g.divisionId,
    stage: g.stage,
    poolLabel: g.poolLabel,
    label: g.label,
    fieldId: g.fieldId,
    startsAt: proj.startsAt,
    date: g.startsAt ? easternDateKey(g.startsAt) : null,
    time: g.startsAt ? easternTimeKey(g.startsAt) : null,
    durationMinutes: g.durationMinutes,
    homeTeamId: g.homeTeamId,
    awayTeamId: g.awayTeamId,
    homePlaceholder: g.homePlaceholder,
    awayPlaceholder: g.awayPlaceholder,
    status: g.status,
    resultType: g.resultType,
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    forfeitWinner: g.forfeitWinner,
    bracketMatchupId: g.bracketMatchupId,
    isPublished: !!g.published,
    hasUnpublishedChanges: !g.published || scheduleKey(g.published) !== scheduleKey(proj),
    updatedAt: g.updatedAt.toISOString(),
  };
}

export async function listAdminGames(tournamentId: string) {
  const rows = await db
    .select()
    .from(games)
    .where(and(eq(games.tournamentId, tournamentId), isNull(games.deletedAt)))
    .orderBy(sql`${games.startsAt} asc nulls last`, asc(games.createdAt));
  return rows.map(serializeAdminGame);
}

/** Teams eligible to be scheduled: active registrations in the division (confirmed for publish). */
async function eligibleTeams(tx: DbOrTx, tournamentId: string, statuses: RegistrationStatus[]) {
  const rows = await tx
    .select({ divisionId: registrations.divisionId, teamId: registrations.teamId })
    .from(registrations)
    .where(and(eq(registrations.tournamentId, tournamentId), inArray(registrations.status, statuses)));
  const map: Record<string, string[]> = {};
  for (const r of rows) (map[r.divisionId] ??= []).push(r.teamId);
  return map;
}

async function tournamentFieldIds(tx: DbOrTx, tournamentId: string) {
  const rows = await tx
    .select({ id: fields.id })
    .from(fields)
    .innerJoin(tournamentVenues, eq(tournamentVenues.venueId, fields.venueId))
    .where(and(eq(tournamentVenues.tournamentId, tournamentId), eq(fields.isActive, true)));
  return new Set(rows.map((r) => r.id));
}

export async function saveDraftGame(ctx: AuthedContext, tournamentId: string, input: GameDraftInput) {
  return db.transaction(async (tx) => {
    const [division] = await tx.select().from(divisions).where(and(eq(divisions.id, input.divisionId), eq(divisions.tournamentId, tournamentId)));
    if (!division) throw new ApiError('VALIDATION_FAILED', 'Choose a division in this tournament.', { fields: { divisionId: 'Invalid' } });
    if (input.fieldId && !(await tournamentFieldIds(tx, tournamentId)).has(input.fieldId)) {
      throw new ApiError('VALIDATION_FAILED', "That field isn't at one of this tournament's venues.", { fields: { fieldId: 'Invalid' } });
    }
    if ((input.date && !input.time) || (!input.date && input.time)) {
      throw new ApiError('VALIDATION_FAILED', 'Enter both a date and a start time, or neither.', { fields: { time: 'Required with date' } });
    }
    const eligible = (await eligibleTeams(tx, tournamentId, ['pending_review', 'confirmed', 'waitlisted']))[division.id] ?? [];
    for (const [k, t] of [['homeTeamId', input.homeTeamId], ['awayTeamId', input.awayTeamId]] as const) {
      if (t && !eligible.includes(t)) throw new ApiError('VALIDATION_FAILED', 'That team is not registered in this division.', { fields: { [k]: 'Not registered' } });
    }
    if (input.homeTeamId && input.homeTeamId === input.awayTeamId) {
      throw new ApiError('VALIDATION_FAILED', 'A team cannot play itself.', { fields: { awayTeamId: 'Same as home' } });
    }
    const startsAt = input.date && input.time ? easternWallTimeToUtc(input.date, input.time) : null;
    const values = {
      divisionId: division.id,
      stage: input.stage,
      poolLabel: input.poolLabel,
      label: input.label,
      fieldId: input.fieldId,
      startsAt,
      durationMinutes: input.durationMinutes,
      homeTeamId: input.homeTeamId,
      awayTeamId: input.awayTeamId,
      homePlaceholder: input.homeTeamId ? null : input.homePlaceholder,
      awayPlaceholder: input.awayTeamId ? null : input.awayPlaceholder,
    };

    if (!input.id) {
      const [g] = await tx.insert(games).values({ ...values, tournamentId }).returning();
      await tx.insert(gameVersions).values({ gameId: g!.id, kind: 'draft_edit', snapshot: toProjection(g!), actorUserId: ctx.user.id });
      return serializeAdminGame(g!);
    }

    const [cur] = await tx.select().from(games).where(and(eq(games.id, input.id), eq(games.tournamentId, tournamentId))).for('update');
    if (!cur || cur.deletedAt) throw notFound('Game');
    if (input.version !== undefined && cur.version !== input.version) throw versionConflict();
    if (cur.bracketMatchupId && (cur.homeTeamId !== values.homeTeamId || cur.awayTeamId !== values.awayTeamId || cur.divisionId !== values.divisionId)) {
      throw new ApiError('CONFLICT', 'Teams in bracket games are set by the bracket. Use the bracket editor to change them.');
    }
    if (cur.status === 'final' && (cur.homeTeamId !== values.homeTeamId || cur.awayTeamId !== values.awayTeamId)) {
      throw new ApiError('CONFLICT', 'This game is final. Correct or reopen the result before changing its teams.');
    }
    const [g] = await tx
      .update(games)
      .set({ ...values, version: cur.version + 1, updatedAt: new Date() })
      .where(eq(games.id, cur.id))
      .returning();
    await tx.insert(gameVersions).values({ gameId: g!.id, kind: 'draft_edit', snapshot: toProjection(g!), actorUserId: ctx.user.id });
    return serializeAdminGame(g!);
  });
}

export async function deleteDraftGame(ctx: AuthedContext, tournamentId: string, gameId: string, version: number) {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(games).where(and(eq(games.id, gameId), eq(games.tournamentId, tournamentId))).for('update');
    if (!cur || cur.deletedAt) throw notFound('Game');
    if (cur.version !== version) throw versionConflict();
    if (cur.bracketMatchupId) throw new ApiError('CONFLICT', 'Bracket games are removed from the bracket editor.');
    if (cur.status === 'final' || cur.homeScore !== null) throw new ApiError('CONFLICT', 'This game has a score. Cancel it instead of deleting it so the history is kept.');
    if (!cur.published) {
      await tx.delete(games).where(eq(games.id, gameId));
    } else {
      // Published games disappear publicly only on the next publish; history is kept.
      await tx.update(games).set({ deletedAt: new Date(), version: cur.version + 1, updatedAt: new Date() }).where(eq(games.id, gameId));
    }
    await audit(tx, ctx, { action: 'game.draft_delete', entityType: 'game', entityId: gameId, tournamentId });
  });
}

// ---- Validation, preview, publish ------------------------------------------------------------

function toScheduleGame(g: GameRow): ScheduleGame {
  return {
    id: g.id,
    label: g.label ?? undefined,
    divisionId: g.divisionId,
    fieldId: g.fieldId,
    startsAt: g.startsAt,
    durationMinutes: g.durationMinutes,
    homeTeamId: g.homeTeamId,
    awayTeamId: g.awayTeamId,
    homePlaceholder: g.homePlaceholder,
    awayPlaceholder: g.awayPlaceholder,
    status: g.status,
    stage: g.stage,
    poolLabel: g.poolLabel,
  };
}

async function loadDraft(tx: DbOrTx, tournamentId: string, lock: boolean) {
  const q = tx.select().from(games).where(eq(games.tournamentId, tournamentId)).orderBy(asc(games.id));
  return lock ? q.for('update') : q;
}

function previewToken(rows: GameRow[]) {
  const h = createHash('sha256');
  for (const g of rows) h.update(`${g.id}:${g.version}:${g.deletedAt ? 'D' : ''};`);
  return h.digest('hex').slice(0, 32);
}

/** Readable labels for issues (game labels are optional, so fall back to time + field). */
function labelGames(rows: GameRow[], fieldNames: Map<string, string>) {
  return rows.map((g) => {
    const s = toScheduleGame(g);
    if (!s.label) {
      const when = g.startsAt ? `${easternDateKey(g.startsAt).slice(5)} ${easternTimeKey(g.startsAt)}` : 'unscheduled';
      s.label = `Game at ${when}${g.fieldId ? ` on ${fieldNames.get(g.fieldId) ?? 'field'}` : ''}`;
    }
    return s;
  });
}

async function fieldNameMap(tx: DbOrTx, tournamentId: string) {
  const rows = await tx
    .select({ id: fields.id, name: fields.name })
    .from(fields)
    .innerJoin(tournamentVenues, eq(tournamentVenues.venueId, fields.venueId))
    .where(eq(tournamentVenues.tournamentId, tournamentId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function validateDraft(tx: DbOrTx, t: typeof tournaments.$inferSelect, rows: GameRow[]): Promise<ScheduleIssue[]> {
  const live = rows.filter((g) => !g.deletedAt);
  const fieldNames = await fieldNameMap(tx, t.id);
  const issues = validateSchedule(labelGames(live, fieldNames), {
    fieldBufferMinutes: t.fieldBufferMinutes,
    minTeamRestMinutes: t.minTeamRestMinutes,
    eligibleTeamsByDivision: await eligibleTeams(tx, t.id, ['confirmed']),
  });
  for (const g of live) {
    if (g.fieldId && !fieldNames.has(g.fieldId)) {
      issues.push({ severity: 'error', code: 'MISSING_FIELD', message: "A game uses a field that isn't at this tournament's venues.", gameIds: [g.id] });
    }
  }
  return issues;
}

export interface SchedulePreview {
  token: string;
  issues: ScheduleIssue[];
  canPublish: boolean;
  changes: { added: string[]; changed: string[]; removed: string[] };
  lastPublishedAt: string | null;
}

export async function previewSchedule(tournamentId: string): Promise<SchedulePreview> {
  const [t] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId));
  if (!t) throw notFound('Tournament');
  const rows = await loadDraft(db, tournamentId, false);
  const issues = await validateDraft(db, t, rows);
  return {
    token: previewToken(rows),
    issues,
    canPublish: !hasBlockingIssues(issues),
    changes: diff(rows),
    lastPublishedAt: t.schedulePublishedAt?.toISOString() ?? null,
  };
}

function diff(rows: GameRow[]) {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const g of rows) {
    if (g.deletedAt) {
      if (g.published) removed.push(g.id);
    } else if (!g.published) added.push(g.id);
    else if (scheduleKey(g.published) !== scheduleKey(toProjection(g))) changed.push(g.id);
  }
  return { added, changed, removed };
}

export async function publishSchedule(ctx: AuthedContext, tournamentId: string, input: { previewToken: string; note: string | null; acknowledgeWarnings: boolean }) {
  return db.transaction(async (tx) => {
    // Tournament row lock serializes concurrent publishes; game row locks block concurrent edits.
    const t = await lockTournament(tx, tournamentId);
    if (t.status === 'draft' || t.status === 'canceled') throw new ApiError('INVALID_TRANSITION', 'Publish the tournament before publishing its schedule.');
    const rows = await loadDraft(tx, tournamentId, true);
    if (previewToken(rows) !== input.previewToken) {
      throw new ApiError('CONFLICT', 'The schedule changed since you previewed it. Review the updated preview before publishing.');
    }
    const issues = await validateDraft(tx, t, rows);
    if (hasBlockingIssues(issues)) throw new ApiError('SCHEDULE_INVALID', 'Fix the schedule errors before publishing.', { issues });
    const warnings = issues.filter((i) => i.severity === 'warning');
    if (warnings.length && !input.acknowledgeWarnings) {
      throw new ApiError('SCHEDULE_INVALID', 'Review and acknowledge the schedule warnings before publishing.', { issues });
    }
    const changes = diff(rows);
    const [last] = await tx
      .select({ n: sql<number>`coalesce(max(${scheduleVersions.versionNumber}), 0)`.mapWith(Number) })
      .from(scheduleVersions)
      .where(eq(scheduleVersions.tournamentId, tournamentId));
    const [sv] = await tx
      .insert(scheduleVersions)
      .values({
        tournamentId,
        versionNumber: (last?.n ?? 0) + 1,
        publishedBy: ctx.user.id,
        note: input.note,
        changeSummary: { added: changes.added.length, changed: changes.changed.length, removed: changes.removed.length },
        warningsAcknowledged: warnings.map((w) => w.message),
      })
      .returning();
    const now = new Date();
    const touched = new Set([...changes.added, ...changes.changed]);
    for (const g of rows) {
      if (g.deletedAt) {
        if (g.published) {
          await tx.insert(gameVersions).values({ gameId: g.id, kind: 'schedule_publish', scheduleVersionId: sv!.id, snapshot: { ...g.published, status: 'canceled' }, actorUserId: ctx.user.id, reason: 'Removed from schedule' });
        }
        await tx.update(games).set({ published: null, publishedAt: now }).where(eq(games.id, g.id));
        continue;
      }
      if (!touched.has(g.id)) continue;
      const proj = toProjection(g);
      await tx.update(games).set({ published: proj, publishedAt: now, updatedAt: now }).where(eq(games.id, g.id));
      await tx.insert(gameVersions).values({ gameId: g.id, kind: 'schedule_publish', scheduleVersionId: sv!.id, snapshot: proj, actorUserId: ctx.user.id, reason: input.note });
    }
    await tx.update(tournaments).set({ schedulePublishedAt: now }).where(eq(tournaments.id, tournamentId));
    await audit(tx, ctx, {
      action: 'schedule.publish',
      entityType: 'tournament',
      entityId: tournamentId,
      tournamentId,
      reason: input.note,
      summary: `v${sv!.versionNumber}: +${changes.added.length} ~${changes.changed.length} -${changes.removed.length}${warnings.length ? `, ${warnings.length} warnings acknowledged` : ''}`,
    });
    return { versionNumber: sv!.versionNumber, publishedAt: now.toISOString(), changes: sv!.changeSummary };
  });
}

/** Conflict check for a live reschedule of one published game against the published schedule. */
export async function validateLiveReschedule(tx: DbOrTx, t: typeof tournaments.$inferSelect, updated: GameRow) {
  const rows = await tx.select().from(games).where(and(eq(games.tournamentId, t.id), isNull(games.deletedAt)));
  const live = rows
    .filter((g) => g.id !== updated.id && g.published)
    .map((g) => ({ ...g, ...publishedAsRow(g.published!) }));
  const fieldNames = await fieldNameMap(tx, t.id);
  const issues = validateSchedule(labelGames([...live, updated] as GameRow[], fieldNames), {
    fieldBufferMinutes: t.fieldBufferMinutes,
    minTeamRestMinutes: t.minTeamRestMinutes,
  });
  return issues.filter((i) => i.gameIds.includes(updated.id));
}

function publishedAsRow(p: PublishedGameProjection) {
  return { ...p, startsAt: p.startsAt ? new Date(p.startsAt) : null };
}

export async function scheduleHistory(tournamentId: string) {
  return db.select().from(scheduleVersions).where(eq(scheduleVersions.tournamentId, tournamentId)).orderBy(sql`${scheduleVersions.versionNumber} desc`);
}

