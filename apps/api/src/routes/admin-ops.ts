import {
  announcementAction,
  announcementInput,
  bracketCreate,
  bracketGameLink,
  bracketOverride,
  bracketSeeding,
  gameAssignmentInput,
  gameDraftInput,
  gameOperationalUpdate,
  roleAssignmentInput,
  schedulePublish,
  type AuditEventDto,
} from '@fd/shared';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client';
import { announcements, auditEvents, brackets, fields, gameAssignments, games, roleAssignments, teams, tournaments, user, venues } from '../db/schema';
import { audit } from '../lib/audit';
import { requireStaff } from '../lib/context';
import { ApiError, notFound } from '../lib/errors';
import { uniqueViolation } from '../lib/pg';
import { assert, canManageStaff, canManageTournament, isSuperAdmin, managedTournamentScope } from '../lib/policy';
import { parse } from '../lib/validate';
import { actOnAnnouncement, adminAnnouncements, createAnnouncement, updateAnnouncement } from '../services/announcements';
import { bracketView, createBracket, deleteBracket, listBrackets, overrideSlot, publishBracket, scheduleMatchup, setSeeds } from '../services/brackets';
import { gameHistory, loadGameForStaff, updateGame } from '../services/games';
import { deleteDraftGame, listAdminGames, previewSchedule, publishSchedule, saveDraftGame, scheduleHistory, serializeAdminGame } from '../services/schedule';

const idParam = z.object({ id: z.uuid() });
const tidParam = z.object({ id: z.uuid() });

async function bracketTournament(id: string) {
  const [b] = await db.select().from(brackets).where(eq(brackets.id, id));
  if (!b) throw notFound('Bracket');
  return b;
}

export const adminOpsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });

  // ---- Schedule builder
  app.get('/tournaments/:id/games', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(tidParam, req.params);
    assert(canManageTournament(ctx, id));
    return listAdminGames(id);
  });

  app.post('/tournaments/:id/schedule/draft', async (req, reply) => {
    const ctx = await requireStaff(req);
    const { id } = parse(tidParam, req.params);
    assert(canManageTournament(ctx, id));
    const input = parse(gameDraftInput, req.body);
    const g = await saveDraftGame(ctx, id, input);
    return reply.status(input.id ? 200 : 201).send(g);
  });

  app.delete('/tournaments/:id/schedule/draft/:gameId', async (req, reply) => {
    const ctx = await requireStaff(req);
    const { id, gameId } = parse(z.object({ id: z.uuid(), gameId: z.uuid() }), req.params);
    assert(canManageTournament(ctx, id));
    const { version } = parse(z.object({ version: z.coerce.number().int() }), req.query);
    await deleteDraftGame(ctx, id, gameId, version);
    return reply.status(204).send();
  });

  app.post('/tournaments/:id/schedule/validate', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(tidParam, req.params);
    assert(canManageTournament(ctx, id));
    return previewSchedule(id);
  });

  app.post('/tournaments/:id/schedule/publish', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(tidParam, req.params);
    assert(canManageTournament(ctx, id));
    return publishSchedule(ctx, id, parse(schedulePublish, req.body));
  });

  app.get('/tournaments/:id/schedule/history', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(tidParam, req.params);
    assert(canManageTournament(ctx, id));
    return scheduleHistory(id);
  });

  // ---- Game operations (directors + assigned scorekeepers)
  app.get('/games/:id', async (req) => {
    const ctx = await requireStaff(req);
    const g = await loadGameForStaff(ctx, parse(idParam, req.params).id);
    const teamIds = [g.homeTeamId, g.awayTeamId].filter((x): x is string => !!x);
    const names = teamIds.length ? await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds)) : [];
    const [fieldRow] = g.fieldId ? await db.select({ name: fields.name, venue: venues.name }).from(fields).innerJoin(venues, eq(venues.id, fields.venueId)).where(eq(fields.id, g.fieldId)) : [];
    const [t] = await db.select({ id: tournaments.id, title: tournaments.title, slug: tournaments.slug }).from(tournaments).where(eq(tournaments.id, g.tournamentId));
    return {
      game: serializeAdminGame(g),
      homeTeamName: names.find((n) => n.id === g.homeTeamId)?.name ?? null,
      awayTeamName: names.find((n) => n.id === g.awayTeamId)?.name ?? null,
      fieldLabel: fieldRow ? `${fieldRow.venue} · ${fieldRow.name}` : null,
      tournament: t,
      history: await gameHistory(g.id),
      canManage: canManageTournament(ctx, g.tournamentId),
    };
  });

  app.patch('/games/:id', async (req) => {
    const ctx = await requireStaff(req);
    return updateGame(ctx, parse(idParam, req.params).id, parse(gameOperationalUpdate, req.body));
  });

  /** Games this staff member can score (scorekeepers see only assigned games). */
  app.get('/my-games', async (req) => {
    const ctx = await requireStaff(req);
    const scope = managedTournamentScope(ctx);
    const assigned = await db.select({ gameId: gameAssignments.gameId }).from(gameAssignments).where(eq(gameAssignments.userId, ctx.user.id));
    const ids = assigned.map((a) => a.gameId);
    const conds = [isNull(games.deletedAt)];
    const scopeCond =
      scope === 'all' ? undefined : scope.length ? sql`(${inArray(games.tournamentId, scope)} or ${ids.length ? inArray(games.id, ids) : sql`false`})` : ids.length ? inArray(games.id, ids) : sql`false`;
    const rows = await db
      .select()
      .from(games)
      .where(and(...conds, scopeCond, sql`${games.published} is not null`))
      .orderBy(sql`${games.startsAt} asc nulls last`)
      .limit(500);
    return rows.map(serializeAdminGame);
  });

  app.post('/game-assignments', async (req) => {
    const ctx = await requireStaff(req);
    const body = parse(gameAssignmentInput, req.body);
    const rows = await db.select({ id: games.id, tournamentId: games.tournamentId }).from(games).where(inArray(games.id, body.gameIds));
    if (rows.length !== new Set(body.gameIds).size) throw notFound('Game');
    for (const r of rows) assert(canManageTournament(ctx, r.tournamentId));
    const [target] = body.userId
      ? await db.select({ id: user.id }).from(user).where(eq(user.id, body.userId))
      : await db.select({ id: user.id }).from(user).where(eq(user.email, body.email!.toLowerCase()));
    if (!target) throw new ApiError('VALIDATION_FAILED', 'No account uses that email.', { fields: { email: 'No account' } });
    // The assignee must hold the scorekeeper role for these tournaments (granted by a super admin).
    const tids = [...new Set(rows.map((r) => r.tournamentId))];
    const roles = await db.select().from(roleAssignments).where(and(eq(roleAssignments.userId, target.id), eq(roleAssignments.role, 'scorekeeper')));
    if (!tids.every((tid) => roles.some((r) => r.tournamentId === null || r.tournamentId === tid))) {
      throw new ApiError('VALIDATION_FAILED', 'That person needs the scorekeeper role for this tournament first.', { fields: { email: 'Not a scorekeeper' } });
    }
    await db.insert(gameAssignments).values(rows.map((r) => ({ userId: target.id, gameId: r.id, assignedBy: ctx.user.id }))).onConflictDoNothing();
    await audit(db, ctx, { action: 'game_assignment.add', entityType: 'user', entityId: target.id, tournamentId: tids[0] ?? null, summary: `${rows.length} games` });
    return { ok: true };
  });

  // ---- Brackets
  app.get('/tournaments/:id/brackets', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(tidParam, req.params);
    assert(canManageTournament(ctx, id));
    const list = await listBrackets(id, { publishedOnly: false });
    return Promise.all(list.map((b) => bracketView(b, serializeAdminGame, { publicTeamNames: true })));
  });

  app.post('/tournaments/:id/brackets', async (req, reply) => {
    const ctx = await requireStaff(req);
    const { id } = parse(tidParam, req.params);
    assert(canManageTournament(ctx, id));
    const b = await createBracket(ctx, id, parse(bracketCreate, req.body));
    return reply.status(201).send(await bracketView(b, serializeAdminGame, { publicTeamNames: true }));
  });

  const withBracket = async (req: FastifyRequest) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    const b = await bracketTournament(id);
    assert(canManageTournament(ctx, b.tournamentId));
    return { ctx, id };
  };
  const viewOf = async (id: string) => bracketView(await bracketTournament(id), serializeAdminGame, { publicTeamNames: true });

  app.post('/brackets/:id/seeds', async (req) => {
    const { ctx, id } = await withBracket(req);
    await setSeeds(ctx, id, parse(bracketSeeding, req.body));
    return viewOf(id);
  });

  app.post('/brackets/:id/schedule-matchup', async (req) => {
    const { ctx, id } = await withBracket(req);
    await scheduleMatchup(ctx, id, parse(bracketGameLink, req.body));
    return viewOf(id);
  });

  app.post('/brackets/:id/override', async (req) => {
    const { ctx, id } = await withBracket(req);
    await overrideSlot(ctx, id, parse(bracketOverride, req.body));
    return viewOf(id);
  });

  app.post('/brackets/:id/publish', async (req) => {
    const { ctx, id } = await withBracket(req);
    await publishBracket(ctx, id, parse(z.object({ version: z.number().int() }), req.body).version);
    return viewOf(id);
  });

  app.delete('/brackets/:id', async (req, reply) => {
    const { ctx, id } = await withBracket(req);
    await deleteBracket(ctx, id);
    return reply.status(204).send();
  });

  // ---- Announcements
  app.get('/announcements', async (req) => {
    const ctx = await requireStaff(req);
    const { tournamentId } = parse(z.object({ tournamentId: z.uuid().optional() }), req.query);
    assert(tournamentId ? canManageTournament(ctx, tournamentId) : isSuperAdmin(ctx));
    return adminAnnouncements(tournamentId ?? null);
  });

  app.post('/announcements', async (req, reply) => {
    const ctx = await requireStaff(req);
    return reply.status(201).send(await createAnnouncement(ctx, parse(announcementInput, req.body)));
  });

  app.patch('/announcements/:id', async (req) => {
    const ctx = await requireStaff(req);
    const { version, data } = parse(z.object({ version: z.number().int(), data: announcementInput }), req.body);
    return updateAnnouncement(ctx, parse(idParam, req.params).id, version, data);
  });

  app.post('/announcements/:id/action', async (req) => {
    const ctx = await requireStaff(req);
    return actOnAnnouncement(ctx, parse(idParam, req.params).id, parse(announcementAction, req.body));
  });

  // ---- Staff & roles (super admin)
  app.get('/staff', async (req) => {
    const ctx = await requireStaff(req);
    assert(canManageStaff(ctx));
    const rows = await db
      .select({ id: roleAssignments.id, role: roleAssignments.role, tournamentId: roleAssignments.tournamentId, userId: user.id, name: user.name, email: user.email, twoFactorEnabled: user.twoFactorEnabled, createdAt: roleAssignments.createdAt })
      .from(roleAssignments)
      .innerJoin(user, eq(user.id, roleAssignments.userId))
      .orderBy(user.name);
    return rows;
  });

  app.post('/staff', async (req, reply) => {
    const ctx = await requireStaff(req);
    assert(canManageStaff(ctx));
    const body = parse(roleAssignmentInput, req.body);
    const [u] = await db.select().from(user).where(eq(user.email, body.email.toLowerCase()));
    if (!u) throw new ApiError('VALIDATION_FAILED', 'No verified account uses that email. Ask the person to create an account first.', { fields: { email: 'No account' } });
    if (!u.emailVerified) throw new ApiError('VALIDATION_FAILED', 'That account has not verified its email yet.', { fields: { email: 'Not verified' } });
    try {
      const [r] = await db.insert(roleAssignments).values({ userId: u.id, role: body.role, tournamentId: body.tournamentId, grantedBy: ctx.user.id }).returning();
      await audit(db, ctx, { action: 'role.grant', entityType: 'user', entityId: u.id, tournamentId: body.tournamentId, summary: body.role });
      return reply.status(201).send(r);
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError('CONFLICT', 'That person already has this role.');
      throw e;
    }
  });

  app.delete('/staff/:id', async (req, reply) => {
    const ctx = await requireStaff(req);
    assert(canManageStaff(ctx));
    const { id } = parse(idParam, req.params);
    const [r] = await db.select().from(roleAssignments).where(eq(roleAssignments.id, id));
    if (!r) throw notFound('Role assignment');
    if (r.userId === ctx.user.id && r.role === 'super_admin') throw new ApiError('CONFLICT', "You can't remove your own super admin role.");
    await db.delete(roleAssignments).where(eq(roleAssignments.id, id));
    await audit(db, ctx, { action: 'role.revoke', entityType: 'user', entityId: r.userId, tournamentId: r.tournamentId, summary: r.role });
    return reply.status(204).send();
  });

  // ---- Audit log
  app.get('/audit-events', async (req): Promise<{ items: AuditEventDto[]; nextBefore: string | null }> => {
    const ctx = await requireStaff(req);
    const q = parse(z.object({ tournamentId: z.uuid().optional(), before: z.iso.datetime().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    if (q.tournamentId) assert(canManageTournament(ctx, q.tournamentId));
    else assert(isSuperAdmin(ctx), 'Choose a tournament to view its audit log.');
    const rows = await db
      .select({ e: auditEvents, actorName: user.name })
      .from(auditEvents)
      .leftJoin(user, eq(user.id, auditEvents.actorUserId))
      .where(and(q.tournamentId ? eq(auditEvents.tournamentId, q.tournamentId) : undefined, q.before ? lt(auditEvents.createdAt, new Date(q.before)) : undefined))
      .orderBy(desc(auditEvents.createdAt))
      .limit(q.limit);
    return {
      items: rows.map(({ e, actorName }) => ({
        id: e.id,
        at: e.createdAt.toISOString(),
        actor: e.actorUserId ? { id: e.actorUserId, name: actorName ?? 'Unknown' } : null,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        tournamentId: e.tournamentId,
        reason: e.reason,
        summary: e.summary,
      })),
      nextBefore: rows.length === q.limit ? rows[rows.length - 1]!.e.createdAt.toISOString() : null,
    };
  });

  // ---- Overview
  app.get('/overview', async (req) => {
    const ctx = await requireStaff(req);
    const scope = managedTournamentScope(ctx);
    const where = scope === 'all' ? undefined : scope.length ? inArray(tournaments.id, scope) : sql`false`;
    const ts = await db.select().from(tournaments).where(where).orderBy(desc(tournaments.startsOn)).limit(20);
    const ids = ts.map((t) => t.id);
    const live = ids.length ? await db.select().from(announcements).where(and(inArray(announcements.tournamentId, ids), eq(announcements.status, 'published'))) : [];
    const recent = ids.length
      ? await db.select({ e: auditEvents, actorName: user.name }).from(auditEvents).leftJoin(user, eq(user.id, auditEvents.actorUserId)).where(inArray(auditEvents.tournamentId, ids)).orderBy(desc(auditEvents.createdAt)).limit(15)
      : [];
    return {
      tournaments: ts.map((t) => ({ id: t.id, title: t.title, slug: t.slug, status: t.status, startsOn: t.startsOn, endsOn: t.endsOn, isDemo: t.isDemo })),
      activeNotices: live.length,
      recent: recent.map(({ e, actorName }) => ({ id: e.id, at: e.createdAt.toISOString(), actor: actorName, action: e.action, summary: e.summary, reason: e.reason, tournamentId: e.tournamentId })),
      roles: ctx.roles,
    };
  });
};
