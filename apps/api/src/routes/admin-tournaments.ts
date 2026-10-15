import {
  divisionInput,
  divisionUpdate,
  fieldInput,
  paymentStatusChange,
  REGISTRATION_STATUSES,
  registrationStatusChange,
  STATUS_LABELS,
  toCsv,
  tournamentInput,
  tournamentTransition,
  tournamentUpdate,
  venueInput,
  rosterReplace,
} from '@fd/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client';
import { divisions, fields, registrations, tournamentRosterSnapshots, tournaments, venues } from '../db/schema';
import { audit } from '../lib/audit';
import { requireStaff } from '../lib/context';
import { ApiError, notFound, versionConflict } from '../lib/errors';
import { uniqueViolation } from '../lib/pg';
import { assert, canCreateTournament, canManageTournament, canManageVenues, managedTournamentScope, staffCanReadTeam } from '../lib/policy';
import { parse } from '../lib/validate';
import { getPublicTournament } from '../services/public';
import { changePaymentStatus, changeRegistrationStatus, getRegistrationDto, listTournamentRegistrations } from '../services/registrations';
import { getRoster, replaceRoster, staffReviseSnapshot } from '../services/teams';
import {
  createDivision,
  createTournament,
  deleteDivision,
  getAdminTournament,
  listAdminTournaments,
  transitionTournament,
  updateDivision,
  updateTournament,
} from '../services/tournaments';

const idParam = z.object({ id: z.uuid() });

async function tournamentIdForDivision(divisionId: string) {
  const [d] = await db.select({ tournamentId: divisions.tournamentId }).from(divisions).where(eq(divisions.id, divisionId));
  if (!d) throw notFound('Division');
  return d.tournamentId;
}

async function tournamentIdForRegistration(id: string) {
  const [r] = await db.select({ tournamentId: registrations.tournamentId }).from(registrations).where(eq(registrations.id, id));
  if (!r) throw notFound('Registration');
  return r.tournamentId;
}

export const adminTournamentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-robots-tag', 'noindex');
  });

  // ---- Tournaments
  app.get('/tournaments', async (req) => {
    const ctx = await requireStaff(req);
    return listAdminTournaments(managedTournamentScope(ctx));
  });

  app.post('/tournaments', async (req, reply) => {
    const ctx = await requireStaff(req);
    assert(canCreateTournament(ctx), 'Only organization-wide directors can create tournaments.');
    const t = await createTournament(ctx, parse(tournamentInput, req.body));
    return reply.status(201).send(await getAdminTournament(t.id));
  });

  app.get('/tournaments/:id', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    assert(canManageTournament(ctx, id));
    return getAdminTournament(id);
  });

  app.patch('/tournaments/:id', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    assert(canManageTournament(ctx, id));
    const { version, data } = parse(tournamentUpdate, req.body);
    await updateTournament(ctx, id, version, data);
    return getAdminTournament(id);
  });

  app.post('/tournaments/:id/transition', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    assert(canManageTournament(ctx, id));
    const body = parse(tournamentTransition, req.body);
    await transitionTournament(ctx, id, body.version, body.to, body.reason);
    return getAdminTournament(id);
  });

  /** Staff preview of the public page, including drafts (spec §7). */
  app.get('/tournaments/:id/preview', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    assert(canManageTournament(ctx, id));
    const [t] = await db.select({ slug: tournaments.slug }).from(tournaments).where(eq(tournaments.id, id));
    if (!t) throw notFound('Tournament');
    return getPublicTournament(t.slug, { allowDraft: true });
  });

  /** Close or reopen roster editing now (spec §16 coach test 4). */
  app.post('/tournaments/:id/roster-lock', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    assert(canManageTournament(ctx, id));
    const body = parse(z.object({ version: z.number().int(), locked: z.boolean(), reason: z.string().trim().max(500).optional() }), req.body);
    await db.transaction(async (tx) => {
      const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, id)).for('update');
      if (!t) throw notFound('Tournament');
      if (t.version !== body.version) throw versionConflict();
      if (!body.locked && !body.reason) throw new ApiError('VALIDATION_FAILED', 'Give a reason for reopening roster edits.', { fields: { reason: 'Required' } });
      await tx.update(tournaments).set({ rosterLocksAt: body.locked ? new Date() : null, version: t.version + 1, updatedAt: new Date() }).where(eq(tournaments.id, id));
      await audit(tx, ctx, { action: body.locked ? 'tournament.roster_lock' : 'tournament.roster_unlock', entityType: 'tournament', entityId: id, tournamentId: id, reason: body.reason ?? null });
    });
    return getAdminTournament(id);
  });

  // ---- Divisions
  app.post('/tournaments/:id/divisions', async (req, reply) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    assert(canManageTournament(ctx, id));
    await createDivision(ctx, id, parse(divisionInput, req.body));
    return reply.status(201).send(await getAdminTournament(id));
  });

  app.patch('/divisions/:id', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    const tid = await tournamentIdForDivision(id);
    assert(canManageTournament(ctx, tid));
    const { version, data } = parse(divisionUpdate, req.body);
    await updateDivision(ctx, id, version, data);
    return getAdminTournament(tid);
  });

  app.delete('/divisions/:id', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    const tid = await tournamentIdForDivision(id);
    assert(canManageTournament(ctx, tid));
    await deleteDivision(ctx, id);
    return getAdminTournament(tid);
  });

  // ---- Registrations (staff)
  const regQuery = z.object({
    status: z.enum(REGISTRATION_STATUSES).optional(),
    q: z.string().trim().max(100).optional(),
    divisionId: z.uuid().optional(),
  });

  app.get('/tournaments/:id/registrations', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    assert(canManageTournament(ctx, id));
    return listTournamentRegistrations(id, parse(regQuery, req.query));
  });

  /** Authorized export; formula-injection-safe; access is audited (spec §8, §17). */
  app.get('/tournaments/:id/registrations.csv', async (req, reply) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    assert(canManageTournament(ctx, id));
    const rows = await listTournamentRegistrations(id, parse(regQuery, req.query));
    await audit(db, ctx, { action: 'registrations.export', entityType: 'tournament', entityId: id, tournamentId: id, summary: `${rows.length} rows` });
    const csv = toCsv([
      ['Reference', 'Division', 'Team', 'Status', 'Payment', 'Manager', 'Manager Email', 'Roster Count', 'Submitted (UTC)'],
      ...rows.map((r) => [r.referenceCode, r.division.name, r.team.name, STATUS_LABELS.registration[r.status], STATUS_LABELS.payment[r.paymentStatus], r.manager.name, r.manager.email, r.rosterCount, r.createdAt]),
    ]);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="registrations-${id.slice(0, 8)}.csv"`).send(csv);
  });

  app.get('/registrations/:id', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    assert(canManageTournament(ctx, await tournamentIdForRegistration(id)));
    return getRegistrationDto(id);
  });

  app.post('/registrations/:id/status', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    assert(canManageTournament(ctx, await tournamentIdForRegistration(id)));
    return changeRegistrationStatus(ctx, id, parse(registrationStatusChange, req.body), { byStaff: true });
  });

  app.post('/registrations/:id/payment-status', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    assert(canManageTournament(ctx, await tournamentIdForRegistration(id)));
    return changePaymentStatus(ctx, id, parse(paymentStatusChange, req.body));
  });

  /** Staff view of a registration's submitted roster. Access to minors' names is audited. */
  app.get('/registrations/:id/roster', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    const tid = await tournamentIdForRegistration(id);
    assert(canManageTournament(ctx, tid));
    const snaps = await db.select().from(tournamentRosterSnapshots).where(eq(tournamentRosterSnapshots.registrationId, id)).orderBy(desc(tournamentRosterSnapshots.revision));
    await audit(db, ctx, { action: 'roster.staff_view', entityType: 'registration', entityId: id, tournamentId: tid });
    return snaps.map((s) => ({ id: s.id, registrationId: id, revision: s.revision, entries: s.entries, createdAt: s.createdAt.toISOString(), reason: s.reason }));
  });

  app.put('/registrations/:id/roster', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    assert(canManageTournament(ctx, await tournamentIdForRegistration(id)));
    const body = parse(z.object({ entries: z.array(z.object({ playerName: z.string().max(200), jerseyNumber: z.string().max(10) })).max(100), reason: z.string().trim().min(1, 'Required').max(500) }), req.body);
    await staffReviseSnapshot(ctx, id, body.entries, body.reason);
    return { ok: true };
  });

  /** Staff edit of a team's live roster: scoped, requires reason, audited (spec §8). */
  app.put('/teams/:id/roster', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    assert(await staffCanReadTeam(db, ctx, id));
    const body = parse(rosterReplace, req.body);
    if (!body.reason) throw new ApiError('VALIDATION_FAILED', 'Staff roster changes require a reason.', { fields: { reason: 'Required' } });
    return replaceRoster(ctx, id, body.version, body.entries, { staff: true, reason: body.reason });
  });

  app.get('/teams/:id/roster', async (req) => {
    const ctx = await requireStaff(req);
    const { id } = parse(idParam, req.params);
    assert(await staffCanReadTeam(db, ctx, id));
    await audit(db, ctx, { action: 'roster.staff_view', entityType: 'team', entityId: id });
    return getRoster(id);
  });

  // ---- Venues & fields
  app.get('/venues', async (req) => {
    await requireStaff(req);
    const vs = await db.select().from(venues).orderBy(asc(venues.name));
    const fs = await db.select().from(fields).orderBy(asc(fields.name));
    return vs.map((v) => ({ ...v, fields: fs.filter((f) => f.venueId === v.id) }));
  });

  app.post('/venues', async (req, reply) => {
    const ctx = await requireStaff(req);
    assert(canManageVenues(ctx));
    const d = parse(venueInput, req.body);
    try {
      const [v] = await db.insert(venues).values({ ...d, state: d.state?.toUpperCase() ?? null }).returning();
      await audit(db, ctx, { action: 'venue.create', entityType: 'venue', entityId: v!.id, summary: d.name });
      return reply.status(201).send({ ...v, fields: [] });
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError('CONFLICT', 'That URL slug is already in use.', { fields: { slug: 'Already in use' } });
      throw e;
    }
  });

  app.patch('/venues/:id', async (req) => {
    const ctx = await requireStaff(req);
    assert(canManageVenues(ctx));
    const { id } = parse(idParam, req.params);
    const { version, data } = parse(z.object({ version: z.number().int(), data: venueInput }), req.body);
    const [v] = await db
      .update(venues)
      .set({ ...data, state: data.state?.toUpperCase() ?? null, version: version + 1, updatedAt: new Date() })
      .where(and(eq(venues.id, id), eq(venues.version, version)))
      .returning();
    if (!v) throw versionConflict();
    await audit(db, ctx, { action: 'venue.update', entityType: 'venue', entityId: id, summary: data.name });
    return v;
  });

  app.post('/venues/:id/fields', async (req, reply) => {
    const ctx = await requireStaff(req);
    assert(canManageVenues(ctx));
    const { id } = parse(idParam, req.params);
    const d = parse(fieldInput, req.body);
    try {
      const [f] = await db.insert(fields).values({ ...d, venueId: id }).returning();
      return reply.status(201).send(f);
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError('CONFLICT', 'A field with that name already exists at this venue.', { fields: { name: 'Already exists' } });
      throw e;
    }
  });

  app.patch('/fields/:id', async (req) => {
    const ctx = await requireStaff(req);
    assert(canManageVenues(ctx));
    const { id } = parse(idParam, req.params);
    const d = parse(fieldInput, req.body);
    const [f] = await db.update(fields).set(d).where(eq(fields.id, id)).returning();
    if (!f) throw notFound('Field');
    return f;
  });
};
