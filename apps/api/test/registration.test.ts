import { beforeAll, describe, expect, it } from 'vitest';
import { anon, expectStatus, freshDb, json, makeTeam, makeUser, register, setupTournament, type Client } from './helpers';

let director: Client;
beforeAll(async () => {
  await freshDb();
  director = await makeUser({ roles: [{ role: 'tournament_director' }] });
});

describe('manager registration (spec §16 coach 1–2)', () => {
  it('one manager owns two independent teams and registers one', async () => {
    const { t, divisionId } = await setupTournament(director, { capacity: 3 });
    const m = await makeUser();
    const a = await makeTeam(m, 'Alpha');
    const b = await makeTeam(m, 'Bravo');
    expect(json(await m.get('/api/me/teams')).map((x: any) => x.name)).toEqual(['Alpha', 'Bravo']);

    const before = json(await anon.get(`/api/tournaments/${t.slug}`)).divisions[0].spotsRemaining;
    const r = json(expectStatus(await register(m, divisionId, a.id), 201));
    expect(r.outcome).toBe('confirmed');
    expect(r.registration.referenceCode).toMatch(/^5D-[A-Z0-9]{6}$/);
    expect(r.registration.timeline.map((e: any) => e.to)).toEqual(['submitted', 'confirmed']);
    const after = json(await anon.get(`/api/tournaments/${t.slug}`)).divisions[0].spotsRemaining;
    expect(after).toBe(before - 1);

    // Duplicate active registration is rejected.
    const dup = await register(m, divisionId, a.id);
    expect(dup.statusCode).toBe(409);
    expect(json(dup).error.code).toBe('DUPLICATE_REGISTRATION');
    // Second team registers separately.
    expectStatus(await register(m, divisionId, b.id), 201);
  });

  it('manual review mode holds the spot as pending review', async () => {
    const { divisionId } = await setupTournament(director, { capacity: 2, reviewMode: 'manual_review' });
    const m = await makeUser();
    const team = await makeTeam(m);
    const r = json(expectStatus(await register(m, divisionId, team.id), 201));
    expect(r.outcome).toBe('pending_review');
  });

  it('only one of many concurrent registrations gets the last spot (spec §16 director 2)', async () => {
    const { t, divisionId } = await setupTournament(director, { capacity: 1 });
    const managers = await Promise.all(Array.from({ length: 8 }, () => makeUser()));
    const teams = await Promise.all(managers.map((m, i) => makeTeam(m, `Racer ${i}`)));
    const results = await Promise.all(managers.map((m, i) => register(m, divisionId, teams[i].id, i % 2 === 0)));
    const ok = results.filter((r) => r.statusCode === 201).map((r) => json(r).outcome);
    expect(ok.filter((o) => o === 'confirmed')).toHaveLength(1);
    // Others either joined the waitlist (when they opted in) or got an accurate CAPACITY_FULL.
    const waitlisted = ok.filter((o) => o === 'waitlisted').length;
    const full = results.filter((r) => r.statusCode === 409 && json(r).error.code === 'CAPACITY_FULL').length;
    expect(1 + waitlisted + full).toBe(8);
    const pub = json(await anon.get(`/api/tournaments/${t.slug}`)).divisions[0];
    expect(pub.spotsRemaining).toBe(0);
    expect(pub.isFull).toBe(true);
    expect(pub.waitlistAvailable).toBe(true);
  });

  it('staff can review: confirm from waitlist only with explicit capacity override', async () => {
    const { t, divisionId } = await setupTournament(director, { capacity: 1 });
    const m1 = await makeUser();
    const m2 = await makeUser();
    expectStatus(await register(m1, divisionId, (await makeTeam(m1)).id), 201);
    const w = json(expectStatus(await register(m2, divisionId, (await makeTeam(m2)).id, true), 201)).registration;
    expect(w.status).toBe('waitlisted');
    expect(w.waitlistPosition).toBe(1);

    const denied = await director.post(`/api/admin/registrations/${w.id}/status`, { version: w.version, to: 'confirmed', reason: 'Promote' });
    expect(json(denied).error.code).toBe('CAPACITY_FULL');
    const ok = json(expectStatus(await director.post(`/api/admin/registrations/${w.id}/status`, { version: w.version, to: 'confirmed', reason: 'Field added', overrideCapacity: true }), 200));
    expect(ok.status).toBe('confirmed');
    const list = json(await director.get(`/api/admin/tournaments/${t.id}/registrations`));
    expect(list).toHaveLength(2);
    const audit = json(await director.get(`/api/admin/audit-events?tournamentId=${t.id}`));
    expect(audit.items.map((e: any) => e.action)).toContain('registration.capacity_override');
  });

  it('stale versions get an actionable conflict instead of a lost update', async () => {
    const { divisionId } = await setupTournament(director, { capacity: 5 });
    const m = await makeUser();
    const r = json(expectStatus(await register(m, divisionId, (await makeTeam(m)).id), 201)).registration;
    expectStatus(await director.post(`/api/admin/registrations/${r.id}/status`, { version: r.version, to: 'pending_review', reason: 'Check roster' }), 200);
    const stale = await director.post(`/api/admin/registrations/${r.id}/status`, { version: r.version, to: 'canceled', reason: 'x' });
    expect(json(stale).error.code).toBe('VERSION_CONFLICT');
  });

  it('closing registration blocks new entries but keeps confirmed teams', async () => {
    const { t, divisionId } = await setupTournament(director, { capacity: 5 });
    const m = await makeUser();
    expectStatus(await register(m, divisionId, (await makeTeam(m)).id), 201);
    const closed = json(expectStatus(await director.post(`/api/admin/tournaments/${t.id}/transition`, { version: t.version, to: 'registration_closed' }), 200));
    expect(closed.counts.confirmed).toBe(1);
    const late = await register(m, divisionId, (await makeTeam(m, 'Late')).id);
    expect(json(late).error.code).toBe('REGISTRATION_CLOSED');
  });

  it('draft tournaments are invisible publicly, even by slug', async () => {
    const d = await director.post('/api/admin/tournaments', { title: 'Secret', slug: 'secret-draft', startsOn: '2030-01-01', endsOn: '2030-01-01', venueIds: [] });
    expectStatus(d, 201);
    expect((await anon.get('/api/tournaments/secret-draft')).statusCode).toBe(404);
    const list = json(await anon.get('/api/tournaments?when=all'));
    expect(list.items.some((x: any) => x.slug === 'secret-draft')).toBe(false);
    // Staff can preview it.
    expect((await director.get(`/api/admin/tournaments/${json(d).id}/preview`)).statusCode).toBe(200);
  });
});

describe('ownership and IDOR (spec §16 coach 5)', () => {
  it("denies another manager's teams, rosters and registrations without revealing existence", async () => {
    const { divisionId } = await setupTournament(director);
    const owner = await makeUser();
    const other = await makeUser();
    const team = await makeTeam(owner, 'Private');
    const reg = json(expectStatus(await register(owner, divisionId, team.id), 201)).registration;

    for (const url of [`/api/me/teams/${team.id}`, `/api/me/teams/${team.id}/roster`, `/api/me/registrations/${reg.id}`, `/api/me/registrations/${reg.id}/snapshots`]) {
      const r = await other.get(url);
      expect(r.statusCode, url).toBe(404);
    }
    expect((await other.patch(`/api/me/teams/${team.id}`, { version: 0, data: { name: 'Hijack', ageGroup: '10U' } })).statusCode).toBe(404);
    expect((await other.put(`/api/me/teams/${team.id}/roster`, { version: 0, entries: [] })).statusCode).toBe(404);
    expect((await register(other, divisionId, team.id)).statusCode).toBe(404);
    expect((await other.post(`/api/me/registrations/${reg.id}/withdraw`, { version: reg.version, reason: 'x' })).statusCode).toBe(404);
    // A nonexistent id looks identical to someone else's.
    expect(json(await other.get(`/api/me/teams/${team.id}`))).toEqual(json(await other.get('/api/me/teams/00000000-0000-4000-8000-000000000000')));
    // Managers cannot reach admin endpoints.
    expect((await other.get(`/api/admin/registrations/${reg.id}`)).statusCode).toBe(403);
  });
});
