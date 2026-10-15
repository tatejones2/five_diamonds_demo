import { beforeAll, describe, expect, it } from 'vitest';
import { anon, expectStatus, freshDb, json, makeTeam, makeUser, register, setupTournament, type Client } from './helpers';

let director: Client;
beforeAll(async () => {
  await freshDb();
  director = await makeUser({ roles: [{ role: 'tournament_director' }] });
});

async function bracketSetup(entrants: number, size: number) {
  const s = await setupTournament(director, { capacity: entrants });
  const teams: string[] = [];
  for (let i = 0; i < entrants; i++) {
    const m = await makeUser();
    const team = await makeTeam(m, `Seed ${i + 1}`);
    expectStatus(await register(m, s.divisionId, team.id), 201);
    teams.push(team.id);
  }
  let b = json(expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/brackets`, { divisionId: s.divisionId, name: 'Championship', size, entrants }), 201));
  b = json(expectStatus(await director.post(`/api/admin/brackets/${b.id}/seeds`, { version: b.version, seeds: teams.map((teamId, i) => ({ seed: i + 1, teamId })) }), 200));
  return { ...s, teams, b };
}

async function scheduleAll(s: Awaited<ReturnType<typeof bracketSetup>>) {
  let b = s.b;
  let hour = 9;
  for (const m of b.matchups.filter((m: any) => !m.slots.some((x: any) => x.isBye))) {
    b = json(expectStatus(await director.post(`/api/admin/brackets/${b.id}/schedule-matchup`, { version: b.version, matchupId: m.id, fieldId: s.fieldIds[0], date: '2030-04-19', time: `${String(hour).padStart(2, '0')}:00`, durationMinutes: 90 }), 200));
    hour += 2;
  }
  b = json(expectStatus(await director.post(`/api/admin/brackets/${b.id}/publish`, { version: b.version }), 200));
  const p = json(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/validate`));
  expect(p.issues.filter((i: any) => i.severity === 'error')).toEqual([]);
  expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/publish`, { previewToken: p.token, acknowledgeWarnings: true }), 200);
  return b;
}

const final = async (gameId: string, home: number, away: number, extra: Record<string, unknown> = {}) => {
  const g = json(await director.get(`/api/admin/games/${gameId}`)).game;
  return director.patch(`/api/admin/games/${gameId}`, { version: g.version, status: 'final', resultType: 'played', homeScore: home, awayScore: away, forfeitWinner: null, ...extra });
};

describe('single-elimination brackets (spec §16 director 5–6)', () => {
  it('builds a 4-team bracket, advances winners only on final, and shows it publicly', async () => {
    const s = await bracketSetup(4, 4);
    const b = await scheduleAll(s);
    const [semi1, semi2, fin] = b.matchups;
    expect(semi1.slots.map((x: any) => x.seed)).toEqual([1, 4]);
    expect(fin.game.homePlaceholder).toBe('Winner of R1 Game 1');

    // In-progress score does not advance.
    const g = json(await director.get(`/api/admin/games/${semi1.gameId}`)).game;
    expectStatus(await director.patch(`/api/admin/games/${semi1.gameId}`, { version: g.version, status: 'in_progress', resultType: 'played', homeScore: 2, awayScore: 1, forfeitWinner: null }), 200);
    let view = json(await director.get(`/api/admin/tournaments/${s.t.id}/brackets`))[0];
    expect(view.matchups[2].slots[0].team).toBeNull();

    // Ties are not allowed in bracket games.
    expect((await final(semi1.gameId, 3, 3)).statusCode).toBe(400);

    expectStatus(await final(semi1.gameId, 5, 2), 200);
    expectStatus(await final(semi2.gameId, 1, 4), 200); // seed 3 (away) beats seed 2
    view = json(await director.get(`/api/admin/tournaments/${s.t.id}/brackets`))[0];
    expect(view.matchups[2].slots.map((x: any) => x.team?.name)).toEqual(['Seed 1', 'Seed 3']);

    const pub = json(await anon.get(`/api/tournaments/${s.t.slug}/brackets`))[0];
    expect(pub.rounds.map((r: any) => r.name)).toEqual(['Semifinals', 'Championship']);
    expect(pub.matchups[2].game.home.name).toBe('Seed 1');
    expect(pub.matchups[0].game.winner).toBe('home');
    expect(pub.matchups[0]).not.toHaveProperty('gameId');
  });

  it('detects downstream conflicts when correcting a semifinal after the final has a result', async () => {
    const s = await bracketSetup(4, 4);
    const b = await scheduleAll(s);
    const [semi1, semi2, fin] = b.matchups;
    expectStatus(await final(semi1.gameId, 5, 2), 200);
    expectStatus(await final(semi2.gameId, 4, 1), 200);
    expectStatus(await final(fin.gameId, 6, 3), 200);

    // Correct semi 1 so the other team wins: must not silently cascade.
    const conflict = await final(semi1.gameId, 2, 5, { reason: 'Scorebook error' });
    expect(conflict.statusCode).toBe(409);
    const body = json(conflict);
    expect(body.error.code).toBe('DOWNSTREAM_CONFLICT');
    expect(body.error.details.impacted.map((i: any) => i.gameId)).toEqual([fin.gameId]);
    // Nothing changed.
    let view = json(await director.get(`/api/admin/tournaments/${s.t.id}/brackets`))[0];
    expect(view.matchups[0].game.homeScore).toBe(5);
    expect(view.matchups[2].game.status).toBe('final');

    // Corrections require a reason.
    expect((await final(semi1.gameId, 2, 5, { downstreamResolution: 'reset_downstream' })).statusCode).toBe(400);

    expectStatus(await final(semi1.gameId, 2, 5, { reason: 'Scorebook error', downstreamResolution: 'reset_downstream' }), 200);
    view = json(await director.get(`/api/admin/tournaments/${s.t.id}/brackets`))[0];
    expect(view.matchups[2].slots[0].team.name).toBe('Seed 4');
    expect(view.matchups[2].game.status).toBe('scheduled');
    expect(view.matchups[2].game.homeScore).toBeNull();

    const audit = json(await director.get(`/api/admin/audit-events?tournamentId=${s.t.id}`)).items.map((e: any) => e.action);
    expect(audit).toContain('game.correct_final');
    expect(audit).toContain('bracket.reset_downstream');
  });

  it('can keep downstream results by explicit director override', async () => {
    const s = await bracketSetup(4, 4);
    const b = await scheduleAll(s);
    const [semi1, semi2, fin] = b.matchups;
    expectStatus(await final(semi1.gameId, 5, 2), 200);
    expectStatus(await final(semi2.gameId, 4, 1), 200);
    expectStatus(await final(fin.gameId, 6, 3), 200);
    expectStatus(await final(semi1.gameId, 6, 2, { reason: 'Run total typo' }), 200); // same winner: no conflict
    expectStatus(await final(semi1.gameId, 2, 6, { reason: 'Protest upheld', downstreamResolution: 'keep_downstream' }), 200);
    const view = json(await director.get(`/api/admin/tournaments/${s.t.id}/brackets`))[0];
    expect(view.matchups[2].game.status).toBe('final');
    expect(view.matchups[2].slots[0].team.name).toBe('Seed 1');
  });

  it('builds a 6-team bracket in an 8-slot draw with byes that auto-advance top seeds', async () => {
    const s = await bracketSetup(6, 8);
    const qf = s.b.matchups.filter((m: any) => m.round === 1);
    expect(qf.filter((m: any) => m.slots.some((x: any) => x.isBye))).toHaveLength(2);
    const semis = s.b.matchups.filter((m: any) => m.round === 2);
    const advanced = semis.flatMap((m: any) => m.slots.map((x: any) => x.team?.name)).filter(Boolean).sort();
    expect(advanced).toEqual(['Seed 1', 'Seed 2']);
  });

  it('refuses invalid sizes and publishing with open seeds', async () => {
    const s = await setupTournament(director, { capacity: 4 });
    const bad = await director.post(`/api/admin/tournaments/${s.t.id}/brackets`, { divisionId: s.divisionId, name: 'X', size: 8, entrants: 3 });
    expect(bad.statusCode).toBe(400);
    const b = json(expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/brackets`, { divisionId: s.divisionId, name: 'Y', size: 4, entrants: 4 }), 201));
    expect((await director.post(`/api/admin/brackets/${b.id}/publish`, { version: b.version })).statusCode).toBe(409);
    expect(json(await anon.get(`/api/tournaments/${s.t.slug}/brackets`))).toEqual([]);
  });
});
