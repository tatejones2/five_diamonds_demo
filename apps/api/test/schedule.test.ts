import { beforeAll, describe, expect, it } from 'vitest';
import { anon, expectStatus, freshDb, json, makeTeam, makeUser, register, setupTournament, type Client } from './helpers';

let director: Client;
beforeAll(async () => {
  await freshDb();
  director = await makeUser({ roles: [{ role: 'tournament_director' }] });
});

async function tournamentWithTeams(n: number) {
  const s = await setupTournament(director, { capacity: n });
  const teams: string[] = [];
  for (let i = 0; i < n; i++) {
    const m = await makeUser();
    const team = await makeTeam(m, `Team ${String.fromCharCode(65 + i)}`);
    expectStatus(await register(m, s.divisionId, team.id), 201);
    teams.push(team.id);
  }
  return { ...s, teams };
}

const game = (s: { divisionId: string; fieldIds: string[] }, over: Record<string, unknown>) => ({
  divisionId: s.divisionId,
  stage: 'pool',
  poolLabel: 'A',
  fieldId: s.fieldIds[0],
  date: '2030-04-18',
  time: '09:00',
  durationMinutes: 90,
  homeTeamId: null,
  awayTeamId: null,
  ...over,
});

describe('native schedule builder (spec §16 director 3–4)', () => {
  it('blocks overlapping field games on publish, then publishes a clean schedule publicly', async () => {
    const s = await tournamentWithTeams(4);
    const g1 = json(expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/draft`, game(s, { homeTeamId: s.teams[0], awayTeamId: s.teams[1] })), 201));
    const g2 = json(expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/draft`, game(s, { time: '10:00', homeTeamId: s.teams[2], awayTeamId: s.teams[3] })), 201));
    expect(g1.time).toBe('09:00');
    expect(g1.startsAt).toBe('2030-04-18T13:00:00.000Z'); // stored UTC, entered Eastern (EDT)

    // Nothing is public before publishing.
    expect(json(await anon.get(`/api/tournaments/${s.t.slug}/games`)).games).toEqual([]);

    let preview = json(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/validate`));
    expect(preview.canPublish).toBe(false);
    expect(preview.issues.map((i: any) => i.code)).toContain('FIELD_OVERLAP');
    const blocked = await director.post(`/api/admin/tournaments/${s.t.id}/schedule/publish`, { previewToken: preview.token });
    expect(json(blocked).error.code).toBe('SCHEDULE_INVALID');

    // Move game 2 to the other field.
    expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/draft`, { ...game(s, { time: '10:00', homeTeamId: s.teams[2], awayTeamId: s.teams[3], fieldId: s.fieldIds[1] }), id: g2.id, version: g2.version }), 200);
    // A stale preview token is refused.
    const stale = await director.post(`/api/admin/tournaments/${s.t.id}/schedule/publish`, { previewToken: preview.token });
    expect(json(stale).error.code).toBe('CONFLICT');

    preview = json(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/validate`));
    expect(preview.canPublish).toBe(true);
    expect(preview.changes.added).toHaveLength(2);
    const pub = json(expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/publish`, { previewToken: preview.token, note: 'Initial' }), 200));
    expect(pub.versionNumber).toBe(1);

    const sched = json(await anon.get(`/api/tournaments/${s.t.slug}/games`));
    expect(sched.games).toHaveLength(2);
    expect(sched.games[0].home.name).toBe('Team A');
    expect(sched.games[0].field.name).toBe('Field 1');
    expect(sched.publishedAt).toBeTruthy();

    // Draft edits stay private until the next publish.
    expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/draft`, { ...game(s, { time: '15:00', homeTeamId: s.teams[0], awayTeamId: s.teams[1] }), id: g1.id, version: g1.version }), 200);
    const still = json(await anon.get(`/api/tournaments/${s.t.slug}/games`));
    expect(still.games.find((g: any) => g.id === g1.id).startsAt).toBe('2030-04-18T13:00:00.000Z');
    const p2 = json(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/validate`));
    expect(p2.changes.changed).toEqual([g1.id]);
  });

  it('blocks team double-booking across fields and rejects unregistered teams', async () => {
    const s = await tournamentWithTeams(3);
    expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/draft`, game(s, { homeTeamId: s.teams[0], awayTeamId: s.teams[1] })), 201);
    expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/draft`, game(s, { fieldId: s.fieldIds[1], time: '09:30', homeTeamId: s.teams[0], awayTeamId: s.teams[2] })), 201);
    const p = json(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/validate`));
    expect(p.issues.map((i: any) => i.code)).toContain('TEAM_OVERLAP');

    const outsider = await makeTeam(await makeUser(), 'Outsider');
    const bad = await director.post(`/api/admin/tournaments/${s.t.id}/schedule/draft`, game(s, { homeTeamId: outsider.id, awayTeamId: s.teams[0] }));
    expect(bad.statusCode).toBe(400);
  });

  it('requires acknowledging warnings (minimum rest) before publishing', async () => {
    const s = await tournamentWithTeams(3);
    const t = json(await director.get(`/api/admin/tournaments/${s.t.id}`));
    const { divisions, counts, id, version, status, isDemo, publishedAt, createdAt, updatedAt, ...data } = t;
    expectStatus(await director.patch(`/api/admin/tournaments/${s.t.id}`, { version, data: { ...data, minTeamRestMinutes: 60 } }), 200);
    expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/draft`, game(s, { homeTeamId: s.teams[0], awayTeamId: s.teams[1] })), 201);
    expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/draft`, game(s, { fieldId: s.fieldIds[1], time: '11:00', homeTeamId: s.teams[0], awayTeamId: s.teams[2] })), 201);
    const p = json(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/validate`));
    expect(p.canPublish).toBe(true);
    expect(p.issues.map((i: any) => `${i.severity}:${i.code}`)).toEqual(['warning:MIN_REST']);
    expect(json(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/publish`, { previewToken: p.token })).error.code).toBe('SCHEDULE_INVALID');
    expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/publish`, { previewToken: p.token, acknowledgeWarnings: true }), 200);
  });

  it('live reschedule of a published game is conflict-checked and needs a reason', async () => {
    const s = await tournamentWithTeams(4);
    const a = json(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/draft`, game(s, { homeTeamId: s.teams[0], awayTeamId: s.teams[1] })));
    json(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/draft`, game(s, { fieldId: s.fieldIds[1], homeTeamId: s.teams[2], awayTeamId: s.teams[3] })));
    const p = json(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/validate`));
    expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/publish`, { previewToken: p.token }), 200);
    const base = { version: a.version, status: 'delayed', resultType: 'played', homeScore: null, awayScore: null, forfeitWinner: null };
    expect((await director.patch(`/api/admin/games/${a.id}`, { ...base, fieldId: s.fieldIds[1] })).statusCode).toBe(400); // reason
    const clash = await director.patch(`/api/admin/games/${a.id}`, { ...base, fieldId: s.fieldIds[1], reason: 'Field 1 flooded' });
    expect(json(clash).error.code).toBe('SCHEDULE_INVALID');
    const moved = json(expectStatus(await director.patch(`/api/admin/games/${a.id}`, { ...base, time: '13:00', reason: 'Rain delay' }), 200));
    expect(moved.time).toBe('13:00');
    const pub = json(await anon.get(`/api/tournaments/${s.t.slug}/games`)).games.find((g: any) => g.id === a.id);
    expect(pub.status).toBe('delayed');
    expect(pub.startsAt).toBe('2030-04-18T17:00:00.000Z');
  });
});
