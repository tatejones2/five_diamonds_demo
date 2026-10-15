import {
  notificationPreferencesInput,
  previewRosterImport,
  registrationCreate,
  rosterReplace,
  ROSTER_TEMPLATE_CSV,
  teamInput,
  teamUpdate,
} from '@fd/shared';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client';
import { games, notificationPreferences, tournamentRosterSnapshots, tournaments } from '../db/schema';
import { publicGameLookups, toPublicGame } from '../services/public';
import { requireUser } from '../lib/context';
import { ApiError } from '../lib/errors';
import { readRosterFile } from '../lib/files';
import { loadOwnTeam } from '../lib/policy';
import { parse } from '../lib/validate';
import { startCheckout } from '../services/payments';
import { changeRegistrationStatus, createRegistration, getMyRegistration, listMyRegistrations } from '../services/registrations';
import { archiveTeam, createTeam, getMyTeam, getRoster, getRosterRules, listMyTeams, replaceRoster, updateTeam } from '../services/teams';

const idParam = z.object({ id: z.uuid() });
const teamParam = z.object({ teamId: z.uuid() });

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });

  // ---- Teams
  app.get('/me/teams', async (req) => listMyTeams(await requireUser(req)));

  app.post('/me/teams', async (req, reply) => {
    const ctx = await requireUser(req);
    return reply.status(201).send(await createTeam(ctx, parse(teamInput, req.body)));
  });

  app.get('/me/teams/:teamId', async (req) => {
    const ctx = await requireUser(req);
    return getMyTeam(ctx, parse(teamParam, req.params).teamId);
  });

  app.patch('/me/teams/:teamId', async (req) => {
    const ctx = await requireUser(req);
    const { version, data } = parse(teamUpdate, req.body);
    return updateTeam(ctx, parse(teamParam, req.params).teamId, version, data);
  });

  app.delete('/me/teams/:teamId', async (req, reply) => {
    const ctx = await requireUser(req);
    await archiveTeam(ctx, parse(teamParam, req.params).teamId);
    return reply.status(204).send();
  });

  // ---- Roster
  app.get('/me/teams/:teamId/roster', async (req) => {
    const ctx = await requireUser(req);
    const { teamId } = parse(teamParam, req.params);
    await loadOwnTeam(db, ctx, teamId);
    return { ...(await getRoster(teamId)), rules: await getRosterRules(teamId) };
  });

  app.put('/me/teams/:teamId/roster', async (req) => {
    const ctx = await requireUser(req);
    const { teamId } = parse(teamParam, req.params);
    await loadOwnTeam(db, ctx, teamId);
    const body = parse(rosterReplace, req.body);
    return replaceRoster(ctx, teamId, body.version, body.entries, { staff: false, reason: null });
  });

  app.post('/me/teams/:teamId/roster/import-preview', async (req) => {
    const ctx = await requireUser(req);
    const { teamId } = parse(teamParam, req.params);
    await loadOwnTeam(db, ctx, teamId);
    const file = await req.file();
    if (!file) throw new ApiError('FILE_REJECTED', 'Choose a file to upload.');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw new ApiError('FILE_REJECTED', 'That file is too large. The limit is 256 KB.');
    const cells = await readRosterFile(file.filename, buf);
    // Preview only: nothing is written until the manager confirms with PUT /roster.
    return previewRosterImport(cells, await getRosterRules(teamId));
  });

  app.get('/me/roster-template.csv', async (_req, reply) => {
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="roster-template.csv"').send(ROSTER_TEMPLATE_CSV);
  });

  // ---- Registrations
  app.post('/registrations', async (req, reply) => {
    const ctx = await requireUser(req);
    const input = parse(registrationCreate, req.body);
    const result = await createRegistration(ctx, input);
    return reply.status(201).send(result);
  });

  app.get('/me/registrations', async (req) => listMyRegistrations(await requireUser(req)));

  app.get('/me/registrations/:id', async (req) => {
    const ctx = await requireUser(req);
    return getMyRegistration(ctx, parse(idParam, req.params).id);
  });

  app.get('/me/registrations/:id/snapshots', async (req) => {
    const ctx = await requireUser(req);
    const { id } = parse(idParam, req.params);
    await getMyRegistration(ctx, id);
    const rows = await db.select().from(tournamentRosterSnapshots).where(eq(tournamentRosterSnapshots.registrationId, id)).orderBy(tournamentRosterSnapshots.revision);
    return rows.map((s) => ({ id: s.id, registrationId: s.registrationId, revision: s.revision, entries: s.entries, createdAt: s.createdAt.toISOString(), reason: s.reason }));
  });

  app.post('/me/registrations/:id/withdraw', async (req) => {
    const ctx = await requireUser(req);
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ version: z.number().int(), reason: z.string().trim().min(1).max(500) }), req.body);
    await getMyRegistration(ctx, id);
    return changeRegistrationStatus(ctx, id, { version: body.version, to: 'withdrawn', reason: body.reason, overrideCapacity: false }, { byStaff: false });
  });

  app.post('/me/registrations/:id/checkout', async (req) => {
    const ctx = await requireUser(req);
    return startCheckout(ctx, parse(idParam, req.params).id);
  });

  /** Published upcoming games for the manager's teams (dashboard). Public projection only. */
  app.get('/me/games', async (req) => {
    const ctx = await requireUser(req);
    const myTeams = await listMyTeams(ctx);
    const ids = myTeams.map((t) => t.id);
    if (!ids.length) return [];
    const rows = await db
      .select({ id: games.id, published: games.published, publishedAt: games.publishedAt, tournamentId: games.tournamentId })
      .from(games)
      .where(and(isNotNull(games.published), or(inArray(games.homeTeamId, ids), inArray(games.awayTeamId, ids))));
    const upcoming = rows.filter((r) => r.published && (!r.published.startsAt || new Date(r.published.startsAt).getTime() > Date.now() - 6 * 3600_000));
    const out = [];
    for (const tid of [...new Set(upcoming.map((r) => r.tournamentId))]) {
      const [t] = await db.select().from(tournaments).where(eq(tournaments.id, tid));
      if (!t) continue;
      const mine = upcoming.filter((r) => r.tournamentId === tid);
      const l = await publicGameLookups(t, mine.map((r) => r.published!));
      for (const r of mine) out.push({ ...toPublicGame(r.id, r.published!, r.publishedAt!, l), tournament: { slug: t.slug, title: t.title } });
    }
    return out.sort((a, b) => (a.startsAt ?? '9').localeCompare(b.startsAt ?? '9')).slice(0, 50);
  });

  // ---- Preferences
  app.get('/me/notification-preferences', async (req) => {
    const ctx = await requireUser(req);
    const [p] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, ctx.user.id));
    return { emailRegistrationUpdates: p?.emailRegistrationUpdates ?? true, emailEventNotices: p?.emailEventNotices ?? false };
  });

  app.put('/me/notification-preferences', async (req) => {
    const ctx = await requireUser(req);
    const input = parse(notificationPreferencesInput, req.body);
    await db
      .insert(notificationPreferences)
      .values({ userId: ctx.user.id, ...input })
      .onConflictDoUpdate({ target: notificationPreferences.userId, set: { ...input, updatedAt: new Date() } });
    return input;
  });
};
