// Operational notices (spec §11): scoped, severity-tagged, with expiry, all-clear and history.
import type { AnnouncementInput, AnnouncementScope, PublicAnnouncement } from '@fd/shared';
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { db } from '../db/client';
import {
  announcementGames,
  announcements,
  divisions,
  fields,
  games,
  notificationPreferences,
  registrations,
  teams,
  tournaments,
  tournamentVenues,
  user,
  venues,
} from '../db/schema';
import { config } from '../config';
import { audit } from '../lib/audit';
import type { AuthedContext } from '../lib/context';
import { ApiError, notFound, versionConflict } from '../lib/errors';
import { isSuperAdmin, canManageTournament, assert } from '../lib/policy';
import { enqueueEmail } from './mailer';

type Row = typeof announcements.$inferSelect;

async function validateScope(tx: DbOrTx, tournamentId: string | null, scope: AnnouncementScope, scopeId: string | null) {
  if (scope === 'organization') {
    if (tournamentId || scopeId) throw new ApiError('VALIDATION_FAILED', 'Organization-wide notices are not tied to a tournament.');
    return;
  }
  if (!tournamentId) throw new ApiError('VALIDATION_FAILED', 'Choose the tournament this notice is for.', { fields: { tournamentId: 'Required' } });
  if (scope === 'tournament') {
    if (scopeId && scopeId !== tournamentId) throw new ApiError('VALIDATION_FAILED', 'Scope does not match tournament.');
    return;
  }
  if (!scopeId) throw new ApiError('VALIDATION_FAILED', `Choose the ${scope} this notice applies to.`, { fields: { scopeId: 'Required' } });
  const ok = await (async () => {
    switch (scope) {
      case 'division':
        return (await tx.select({ id: divisions.id }).from(divisions).where(and(eq(divisions.id, scopeId), eq(divisions.tournamentId, tournamentId)))).length > 0;
      case 'venue':
        return (await tx.select({ v: tournamentVenues.venueId }).from(tournamentVenues).where(and(eq(tournamentVenues.venueId, scopeId), eq(tournamentVenues.tournamentId, tournamentId)))).length > 0;
      case 'field':
        return (
          await tx
            .select({ id: fields.id })
            .from(fields)
            .innerJoin(tournamentVenues, eq(tournamentVenues.venueId, fields.venueId))
            .where(and(eq(fields.id, scopeId), eq(tournamentVenues.tournamentId, tournamentId)))
        ).length > 0;
      case 'game':
        return (await tx.select({ id: games.id }).from(games).where(and(eq(games.id, scopeId), eq(games.tournamentId, tournamentId)))).length > 0;
    }
  })();
  if (!ok) throw new ApiError('VALIDATION_FAILED', `That ${scope} is not part of this tournament.`, { fields: { scopeId: 'Invalid' } });
}

function assertCanManage(ctx: AuthedContext, tournamentId: string | null) {
  assert(tournamentId ? canManageTournament(ctx, tournamentId) : isSuperAdmin(ctx), 'You cannot publish notices for this scope.');
}

export async function createAnnouncement(ctx: AuthedContext, input: AnnouncementInput) {
  assertCanManage(ctx, input.tournamentId);
  return db.transaction(async (tx) => {
    await validateScope(tx, input.tournamentId, input.scope, input.scope === 'tournament' ? input.tournamentId : input.scopeId);
    if (input.expiresAt && input.effectiveAt && input.expiresAt <= input.effectiveAt) {
      throw new ApiError('VALIDATION_FAILED', 'Expiry must be after the effective time.', { fields: { expiresAt: 'Too early' } });
    }
    const [a] = await tx
      .insert(announcements)
      .values({
        tournamentId: input.tournamentId,
        scope: input.scope,
        scopeId: input.scope === 'tournament' ? input.tournamentId : input.scopeId,
        severity: input.severity,
        category: input.category,
        title: input.title,
        body: input.body,
        source: input.source,
        linkUrl: input.linkUrl,
        effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        authorUserId: ctx.user.id,
      })
      .returning();
    await setAffectedGames(tx, a!.id, input.tournamentId, input.affectedGameIds);
    return a!;
  });
}

export async function updateAnnouncement(ctx: AuthedContext, id: string, version: number, input: AnnouncementInput) {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(announcements).where(eq(announcements.id, id)).for('update');
    if (!cur) throw notFound('Notice');
    assertCanManage(ctx, cur.tournamentId);
    if (cur.version !== version) throw versionConflict();
    if (input.tournamentId !== cur.tournamentId) throw new ApiError('VALIDATION_FAILED', 'A notice cannot move to another tournament.');
    await validateScope(tx, input.tournamentId, input.scope, input.scope === 'tournament' ? input.tournamentId : input.scopeId);
    const [a] = await tx
      .update(announcements)
      .set({
        scope: input.scope,
        scopeId: input.scope === 'tournament' ? input.tournamentId : input.scopeId,
        severity: input.severity,
        category: input.category,
        title: input.title,
        body: input.body,
        source: input.source,
        linkUrl: input.linkUrl,
        effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        version: cur.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(announcements.id, id))
      .returning();
    await setAffectedGames(tx, id, cur.tournamentId, input.affectedGameIds);
    if (cur.status !== 'draft') {
      await audit(tx, ctx, { action: 'announcement.edit_published', entityType: 'announcement', entityId: id, tournamentId: cur.tournamentId, data: { before: { title: cur.title, body: cur.body }, after: { title: input.title, body: input.body } } });
    }
    return a!;
  });
}

async function setAffectedGames(tx: DbOrTx, announcementId: string, tournamentId: string | null, gameIds: string[]) {
  await tx.delete(announcementGames).where(eq(announcementGames.announcementId, announcementId));
  if (!gameIds.length) return;
  if (!tournamentId) throw new ApiError('VALIDATION_FAILED', 'Organization-wide notices cannot reference games.');
  const valid = await tx.select({ id: games.id }).from(games).where(and(inArray(games.id, gameIds), eq(games.tournamentId, tournamentId)));
  if (valid.length !== new Set(gameIds).size) throw new ApiError('VALIDATION_FAILED', 'Some affected games are not in this tournament.');
  await tx.insert(announcementGames).values(valid.map((g) => ({ announcementId, gameId: g.id })));
}

export async function actOnAnnouncement(ctx: AuthedContext, id: string, input: { version: number; action: 'publish' | 'all_clear' | 'withdraw'; message: string | null }) {
  const result = await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(announcements).where(eq(announcements.id, id)).for('update');
    if (!cur) throw notFound('Notice');
    assertCanManage(ctx, cur.tournamentId);
    if (cur.version !== input.version) throw versionConflict();
    const now = new Date();
    let patch: Partial<Row>;
    if (input.action === 'publish') {
      if (cur.status !== 'draft') throw new ApiError('INVALID_TRANSITION', 'Only drafts can be published.');
      patch = { status: 'published', publishedAt: now };
    } else if (input.action === 'all_clear') {
      if (cur.status !== 'published') throw new ApiError('INVALID_TRANSITION', 'Only a published notice can be given an all-clear.');
      patch = { status: 'all_clear', allClearAt: now, allClearMessage: input.message ?? 'All clear.' };
    } else {
      if (cur.status === 'withdrawn') throw new ApiError('INVALID_TRANSITION', 'Already withdrawn.');
      if (cur.status !== 'draft' && !input.message) throw new ApiError('VALIDATION_FAILED', 'Give a reason for withdrawing a published notice.', { fields: { message: 'Required' } });
      patch = { status: 'withdrawn' };
    }
    const [a] = await tx.update(announcements).set({ ...patch, version: cur.version + 1, updatedAt: now }).where(eq(announcements.id, id)).returning();
    await audit(tx, ctx, { action: `announcement.${input.action}`, entityType: 'announcement', entityId: id, tournamentId: cur.tournamentId, reason: input.message, summary: `[${cur.severity}] ${cur.title}` });
    return a!;
  });
  if (input.action === 'publish' || input.action === 'all_clear') await emailSubscribers(result).catch(() => {});
  return result;
}

/** Opt-in emails to managers with teams in the tournament. On-site notice is the source of truth. */
async function emailSubscribers(a: Row) {
  if (!a.tournamentId) return;
  const [t] = await db.select({ title: tournaments.title, slug: tournaments.slug }).from(tournaments).where(eq(tournaments.id, a.tournamentId));
  const recipients = await db
    .selectDistinct({ id: user.id, email: user.email })
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .innerJoin(user, eq(user.id, teams.ownerUserId))
    .innerJoin(notificationPreferences, eq(notificationPreferences.userId, user.id))
    .where(
      and(
        eq(registrations.tournamentId, a.tournamentId),
        inArray(registrations.status, ['confirmed', 'pending_review', 'waitlisted']),
        eq(notificationPreferences.emailEventNotices, true),
      ),
    );
  for (const r of recipients) {
    await enqueueEmail({
      to: r.email,
      userId: r.id,
      template: 'event_notice',
      idempotencyKey: `notice:${a.id}:${a.status}:${r.id}`,
      subject: `${a.status === 'all_clear' ? 'ALL CLEAR: ' : a.severity === 'critical' ? 'ALERT: ' : ''}${a.title} — ${t?.title ?? ''}`,
      text: `${a.status === 'all_clear' ? (a.allClearMessage ?? 'All clear.') + '\n\nOriginal notice:\n' : ''}${a.body}\n\nLatest updates: ${config.APP_ORIGIN}/tournaments/${t?.slug}/updates`,
    });
  }
}

// ---- Read models ------------------------------------------------------------------------------

const activeNow = (now: Date) =>
  and(eq(announcements.status, 'published'), or(isNull(announcements.effectiveAt), lte(announcements.effectiveAt, now)), or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)));

export async function serializeAnnouncements(rows: Row[]): Promise<PublicAnnouncement[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const affected = await db.select().from(announcementGames).where(inArray(announcementGames.announcementId, ids));
  const tIds = [...new Set(rows.map((r) => r.tournamentId).filter((x): x is string => !!x))];
  const ts = tIds.length ? await db.select({ id: tournaments.id, slug: tournaments.slug }).from(tournaments).where(inArray(tournaments.id, tIds)) : [];
  const authorIds = [...new Set(rows.map((r) => r.authorUserId).filter((x): x is string => !!x))];
  const authors = authorIds.length ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, authorIds)) : [];
  const labels = await scopeLabels(rows);
  return rows.map((r) => ({
    id: r.id,
    tournamentId: r.tournamentId,
    tournamentSlug: ts.find((t) => t.id === r.tournamentId)?.slug ?? null,
    scope: r.scope,
    scopeLabel: labels.get(r.id) ?? '',
    severity: r.severity,
    category: r.category,
    status: r.status,
    title: r.title,
    body: r.body,
    effectiveAt: r.effectiveAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
    allClearMessage: r.allClearMessage,
    affectedGameIds: affected.filter((x) => x.announcementId === r.id).map((x) => x.gameId),
    linkUrl: r.linkUrl,
    source: r.source,
    // Staff first name only on public pages ("issued by" accountability without full PII).
    authorName: authors.find((a) => a.id === r.authorUserId)?.name.split(' ')[0] ?? null,
  }));
}

async function scopeLabels(rows: Row[]) {
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r.scope === 'organization') m.set(r.id, 'All events');
    else if (r.scope === 'tournament') m.set(r.id, 'Entire tournament');
    else if (r.scopeId) {
      let label = '';
      if (r.scope === 'division') label = (await db.select({ n: divisions.name }).from(divisions).where(eq(divisions.id, r.scopeId)))[0]?.n ?? '';
      if (r.scope === 'venue') label = (await db.select({ n: venues.name }).from(venues).where(eq(venues.id, r.scopeId)))[0]?.n ?? '';
      if (r.scope === 'field') {
        const [f] = await db.select({ n: fields.name, v: venues.name }).from(fields).innerJoin(venues, eq(venues.id, fields.venueId)).where(eq(fields.id, r.scopeId));
        label = f ? `${f.v} — ${f.n}` : '';
      }
      if (r.scope === 'game') label = (await db.select({ n: games.label }).from(games).where(eq(games.id, r.scopeId)))[0]?.n ?? 'One game';
      m.set(r.id, label);
    }
  }
  return m;
}

export async function activeAlerts(tournamentId: string | null, now = new Date()) {
  const rows = await db
    .select()
    .from(announcements)
    .where(and(activeNow(now), tournamentId ? or(eq(announcements.tournamentId, tournamentId), eq(announcements.scope, 'organization')) : undefined))
    .orderBy(sql`case ${announcements.severity} when 'critical' then 0 when 'advisory' then 1 else 2 end`, desc(announcements.publishedAt));
  return serializeAnnouncements(rows);
}

/** Full public history: published, all-clear and withdrawn-after-publish notices. */
export async function announcementHistory(tournamentId: string) {
  const rows = await db
    .select()
    .from(announcements)
    .where(and(eq(announcements.tournamentId, tournamentId), inArray(announcements.status, ['published', 'all_clear', 'superseded'])))
    .orderBy(desc(announcements.publishedAt));
  return serializeAnnouncements(rows);
}

export async function adminAnnouncements(tournamentId: string | null) {
  const rows = await db
    .select()
    .from(announcements)
    .where(tournamentId ? eq(announcements.tournamentId, tournamentId) : isNull(announcements.tournamentId))
    .orderBy(desc(announcements.createdAt));
  return Promise.all((await serializeAnnouncements(rows)).map(async (a, i) => ({ ...a, version: rows[i]!.version })));
}
