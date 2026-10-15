import { beforeAll, describe, expect, it } from 'vitest';
import { anon, expectStatus, freshDb, grant, json, makeTeam, makeUser, register, setupTournament, type Client } from './helpers';

let director: Client;
let s: Awaited<ReturnType<typeof setupTournament>>;
let gameA: any;
let gameB: any;
let managerEmail: string;

beforeAll(async () => {
  await freshDb();
  director = await makeUser({ roles: [{ role: 'tournament_director' }] });
  s = await setupTournament(director, { capacity: 4 });
  const teams: string[] = [];
  for (let i = 0; i < 4; i++) {
    const m = await makeUser({ name: `Private Manager ${i}` });
    if (i === 0) managerEmail = m.email;
    const team = json(expectStatus(await m.post('/api/me/teams', { name: `Club ${i}`, ageGroup: '10U', coachContactPhone: '555-0100', coachContactEmail: m.email }), 201));
    expectStatus(await m.put(`/api/me/teams/${team.id}/roster`, { version: 0, entries: [{ playerName: 'Secretchild Name', jerseyNumber: '4' }] }), 200);
    expectStatus(await register(m, s.divisionId, team.id), 201);
    teams.push(team.id);
  }
  const mk = (over: object) => director.post(`/api/admin/tournaments/${s.t.id}/schedule/draft`, { divisionId: s.divisionId, stage: 'pool', fieldId: s.fieldIds[0], date: '2030-04-18', durationMinutes: 90, ...over });
  gameA = json(expectStatus(await mk({ time: '09:00', homeTeamId: teams[0], awayTeamId: teams[1] }), 201));
  gameB = json(expectStatus(await mk({ time: '11:00', homeTeamId: teams[2], awayTeamId: teams[3] }), 201));
  const p = json(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/validate`));
  expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/publish`, { previewToken: p.token }), 200);
});

const scoreBody = (g: any, over: object = {}) => ({ version: g.version, status: 'in_progress', resultType: 'played', homeScore: 1, awayScore: 0, forfeitWinner: null, ...over });

describe('scorekeeper scoping (spec §16 director 8)', () => {
  it('rejects unassigned staff and allows only assigned games', async () => {
    const sk = await makeUser({ roles: [{ role: 'scorekeeper', tournamentId: s.t.id }] });
    const denied = await sk.patch(`/api/admin/games/${gameA.id}`, scoreBody(gameA));
    expect(denied.statusCode).toBe(403);

    expectStatus(await director.post('/api/admin/game-assignments', { userId: sk.userId, gameIds: [gameA.id] }), 200);
    const ok = json(expectStatus(await sk.patch(`/api/admin/games/${gameA.id}`, scoreBody(gameA)), 200));
    expect(ok.homeScore).toBe(1);
    expect((await sk.patch(`/api/admin/games/${gameB.id}`, scoreBody(gameB))).statusCode).toBe(403);

    // Scorekeepers cannot move games or correct finals.
    expect((await sk.patch(`/api/admin/games/${gameA.id}`, scoreBody(ok, { fieldId: s.fieldIds[1], reason: 'x' }))).statusCode).toBe(403);
    const fin = json(expectStatus(await sk.patch(`/api/admin/games/${gameA.id}`, scoreBody(ok, { status: 'final', homeScore: 3, awayScore: 1 })), 200));
    expect((await sk.patch(`/api/admin/games/${gameA.id}`, scoreBody(fin, { status: 'final', homeScore: 4, awayScore: 1, reason: 'oops' }))).statusCode).toBe(403);
    // ...and cannot reach director tools.
    expect((await sk.get(`/api/admin/tournaments/${s.t.id}/registrations`)).statusCode).toBe(403);
    expect((await sk.get(`/api/admin/registrations/${'0'.repeat(8)}-0000-4000-8000-000000000000`)).statusCode).toBeGreaterThanOrEqual(403);
    const mine = json(await sk.get('/api/admin/my-games'));
    expect(mine.map((g: any) => g.id)).toEqual([gameA.id]);
  });

  it('scopes tournament directors to their assigned tournaments', async () => {
    const other = await setupTournament(director);
    const scoped = await makeUser();
    await grant(scoped, 'tournament_director', s.t.id);
    expect((await scoped.get(`/api/admin/tournaments/${s.t.id}`)).statusCode).toBe(200);
    expect((await scoped.get(`/api/admin/tournaments/${other.t.id}`)).statusCode).toBe(403);
    expect((await scoped.post('/api/admin/tournaments', { title: 'x', slug: 'x-new', startsOn: '2030-01-01', endsOn: '2030-01-01' })).statusCode).toBe(403);
    expect(json(await scoped.get('/api/admin/tournaments')).map((t: any) => t.id)).toEqual([s.t.id]);
    expect((await scoped.get('/api/admin/staff')).statusCode).toBe(403);
  });

  it('content editors manage content but not tournaments; managers get nothing', async () => {
    const editor = await makeUser({ roles: [{ role: 'content_editor' }] });
    expect((await editor.get('/api/admin/content/pages')).statusCode).toBe(200);
    expect((await editor.get(`/api/admin/tournaments/${s.t.id}`)).statusCode).toBe(403);
    const manager = await makeUser();
    expect((await manager.get('/api/admin/content/pages')).statusCode).toBe(403);
    expect((await manager.patch(`/api/admin/games/${gameB.id}`, scoreBody(gameB))).statusCode).toBe(403);
    expect((await anon.post('/api/admin/tournaments', {})).statusCode).toBe(401);
  });

  it('only super admins grant roles, and grants are audited', async () => {
    const admin = await makeUser({ roles: [{ role: 'super_admin' }] });
    const target = await makeUser();
    expect((await director.post('/api/admin/staff', { email: target.email, role: 'super_admin', tournamentId: null })).statusCode).toBe(403);
    expectStatus(await admin.post('/api/admin/staff', { email: target.email, role: 'scorekeeper', tournamentId: s.t.id }), 201);
    const audit = json(await admin.get('/api/admin/audit-events'));
    expect(audit.items[0].action).toBe('role.grant');
  });
});

describe('public responses never leak private data (spec §14)', () => {
  it('omits player names, contact details and payment data from every public endpoint', async () => {
    const urls = ['/api/tournaments?when=all', `/api/tournaments/${s.t.slug}`, `/api/tournaments/${s.t.slug}/games`, `/api/tournaments/${s.t.slug}/teams`, `/api/tournaments/${s.t.slug}/standings`, `/api/tournaments/${s.t.slug}/brackets`, `/api/tournaments/${s.t.slug}/announcements`, '/api/game-day', '/api/facilities'];
    for (const u of urls) {
      const r = await anon.get(u);
      expect(r.statusCode, u).toBe(200);
      const body = r.body;
      expect(body, u).not.toContain('Secretchild');
      expect(body, u).not.toContain('555-0100');
      expect(body, u).not.toContain(managerEmail);
      expect(body, u).not.toContain('Private Manager');
      expect(body, u).not.toMatch(/paymentStatus|payment_status|coachContact|referenceCode/);
    }
    const teams = json(await anon.get(`/api/tournaments/${s.t.slug}/teams`));
    expect(teams.divisions[0].teams.map((t: any) => Object.keys(t).sort())).toEqual(Array(4).fill(['city', 'id', 'name', 'state']));
  });

  it('hides team names when the tournament opts out', async () => {
    const t = json(await director.get(`/api/admin/tournaments/${s.t.id}`));
    const { divisions, counts, id, version, status, isDemo, publishedAt, createdAt, updatedAt, ...data } = t;
    expectStatus(await director.patch(`/api/admin/tournaments/${s.t.id}`, { version, data: { ...data, publicTeamNames: false } }), 200);
    expect((await anon.get(`/api/tournaments/${s.t.slug}/games`)).body).not.toContain('Club 0');
    expect(json(await anon.get(`/api/tournaments/${s.t.slug}/teams`)).visible).toBe(false);
    expectStatus(await director.patch(`/api/admin/tournaments/${s.t.id}`, { version: version + 1, data: { ...data, publicTeamNames: true } }), 200);
  });
});
