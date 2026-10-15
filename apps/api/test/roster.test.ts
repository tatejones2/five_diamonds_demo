import { beforeAll, describe, expect, it } from 'vitest';
import { expectStatus, freshDb, getApp, json, makeTeam, makeUser, ORIGIN, register, setupTournament, type Client } from './helpers';

let director: Client;
beforeAll(async () => {
  await freshDb();
  director = await makeUser({ roles: [{ role: 'tournament_director' }] });
});

async function upload(c: Client, teamId: string, filename: string, content: Buffer | string, contentType = 'text/csv') {
  const boundary = '----fdtest' + Math.random().toString(16).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const app = await getApp();
  return app.inject({ method: 'POST', url: `/api/me/teams/${teamId}/roster/import-preview`, headers: { origin: ORIGIN, cookie: c.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
}

describe('roster editing and import (spec §16 coach 3)', () => {
  it('saves a manual roster with jersey 0 and 00 kept distinct', async () => {
    const m = await makeUser();
    const team = await makeTeam(m);
    const r = json(expectStatus(await m.put(`/api/me/teams/${team.id}/roster`, { version: 0, entries: [{ playerName: 'Alex Demo', jerseyNumber: '0' }, { playerName: 'Blake Demo', jerseyNumber: '00' }, { playerName: 'Casey Demo', jerseyNumber: '#7' }] }), 200));
    expect(r.count).toBe(3);
    const roster = json(await m.get(`/api/me/teams/${team.id}/roster`));
    expect(roster.entries.map((e: any) => e.jerseyNumber)).toEqual(['0', '00', '7']);
    expect(roster.version).toBe(1);
  });

  it('import preview flags duplicates and malformed rows and commits nothing', async () => {
    const m = await makeUser();
    const team = await makeTeam(m);
    expectStatus(await m.put(`/api/me/teams/${team.id}/roster`, { version: 0, entries: [{ playerName: 'Keep Me', jerseyNumber: '1' }] }), 200);
    const csv = 'Player Name,Jersey Number\nAlex Demo,7\nBlake Demo,7\n,12\nCasey Demo,abc\n=HYPERLINK("x"),5\n';
    const p = json(expectStatus(await upload(m, team.id, 'roster.csv', csv), 200));
    expect(p.fileErrors).toEqual([]);
    expect(p.validation.valid).toBe(false);
    const bad = p.validation.rows.filter((r: any) => r.errors.length).map((r: any) => r.sourceRow);
    expect(bad).toEqual([2, 3, 4, 5, 6]);
    // Preview wrote nothing.
    const roster = json(await m.get(`/api/me/teams/${team.id}/roster`));
    expect(roster.entries.map((e: any) => e.playerName)).toEqual(['Keep Me']);

    // Submitting the invalid rows anyway is rejected atomically.
    const rows = p.validation.rows.map((r: any) => ({ playerName: r.playerName, jerseyNumber: r.jerseyNumber }));
    const put = await m.put(`/api/me/teams/${team.id}/roster`, { version: roster.version, entries: rows });
    expect(put.statusCode).toBe(400);
    expect(json(await m.get(`/api/me/teams/${team.id}/roster`)).entries).toHaveLength(1);
  });

  it('rejects non-roster files', async () => {
    const m = await makeUser();
    const team = await makeTeam(m);
    expect(json(await upload(m, team.id, 'evil.exe', 'MZ...')).error.code).toBe('FILE_REJECTED');
    expect(json(await upload(m, team.id, 'fake.xlsx', 'not a zip')).error.code).toBe('FILE_REJECTED');
    expect(json(await upload(m, team.id, 'bin.csv', Buffer.from([0x41, 0x00, 0x42]))).error.code).toBe('FILE_REJECTED');
    expect(json(await upload(m, team.id, 'big.csv', 'a'.repeat(300 * 1024))).error.code).toBe('FILE_REJECTED');
  });

  it('enforces the division roster max for registered teams', async () => {
    const { divisionId } = await setupTournament(director);
    const m = await makeUser();
    const team = await makeTeam(m);
    expectStatus(await register(m, divisionId, team.id), 201);
    const entries = Array.from({ length: 16 }, (_, i) => ({ playerName: `Player ${'abcdefghijklmnopq'[i]}`, jerseyNumber: String(i) }));
    const r = await m.put(`/api/me/teams/${team.id}/roster`, { version: 0, entries });
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(json(r))).toContain('limit is 15');
  });
});

describe('roster lock and event snapshots (spec §16 coach 4)', () => {
  it('freezes the submitted event roster after staff lock while the manager can still review it', async () => {
    const { t, divisionId } = await setupTournament(director);
    const m = await makeUser();
    const team = await makeTeam(m);
    expectStatus(await m.put(`/api/me/teams/${team.id}/roster`, { version: 0, entries: [{ playerName: 'Original Player', jerseyNumber: '1' }] }), 200);
    const reg = json(expectStatus(await register(m, divisionId, team.id), 201)).registration;
    expect(reg.latestSnapshot.entries).toEqual([{ playerName: 'Original Player', jerseyNumber: '1' }]);

    // Edit before lock refreshes the event snapshot.
    expectStatus(await m.put(`/api/me/teams/${team.id}/roster`, { version: 1, entries: [{ playerName: 'Original Player', jerseyNumber: '1' }, { playerName: 'Added Before Lock', jerseyNumber: '2' }] }), 200);
    expect(json(await m.get(`/api/me/registrations/${reg.id}`)).latestSnapshot.entries).toHaveLength(2);

    const fresh = json(await director.get(`/api/admin/tournaments/${t.id}`));
    expectStatus(await director.post(`/api/admin/tournaments/${t.id}/roster-lock`, { version: fresh.version, locked: true }), 200);

    const roster = json(await m.get(`/api/me/teams/${team.id}/roster`));
    expect(roster.locks).toHaveLength(1);
    expect(roster.isLocked).toBe(true);

    const after = json(expectStatus(await m.put(`/api/me/teams/${team.id}/roster`, { version: 2, entries: [{ playerName: 'After Lock', jerseyNumber: '9' }] }), 200));
    expect(after.frozenRegistrations).toHaveLength(1);
    expect(after.refreshedRegistrations).toHaveLength(0);

    const snap = json(await m.get(`/api/me/registrations/${reg.id}`)).latestSnapshot;
    expect(snap.entries.map((e: any) => e.playerName)).toEqual(['Original Player', 'Added Before Lock']);
    const history = json(await m.get(`/api/me/registrations/${reg.id}/snapshots`));
    expect(history.map((s: any) => s.revision)).toEqual([1, 2]);

    // Staff revision after lock requires a reason and is audited.
    expect((await director.put(`/api/admin/registrations/${reg.id}/roster`, { entries: [{ playerName: 'Late Add', jerseyNumber: '3' }] })).statusCode).toBe(400);
    expectStatus(await director.put(`/api/admin/registrations/${reg.id}/roster`, { entries: [{ playerName: 'Late Add', jerseyNumber: '3' }], reason: 'Approved injury replacement' }), 200);
    const audit = json(await director.get(`/api/admin/audit-events?tournamentId=${t.id}`)).items.map((e: any) => e.action);
    expect(audit).toContain('roster_snapshot.staff_revise');
    expect(audit).toContain('tournament.roster_lock');
  });
});

describe('exports are safe and audited', () => {
  it('neutralizes formula injection in registration CSV export', async () => {
    const { t, divisionId } = await setupTournament(director);
    const m = await makeUser({ name: '=cmd|calc' });
    const team = json(expectStatus(await m.post('/api/me/teams', { name: '+SUM(A1)', ageGroup: '10U' }), 201));
    expectStatus(await register(m, divisionId, team.id), 201);
    const r = expectStatus(await director.get(`/api/admin/tournaments/${t.id}/registrations.csv`), 200);
    expect(r.body).toContain("'+SUM(A1)");
    expect(r.body).toContain("'=cmd|calc");
    expect(r.body).not.toMatch(/,=cmd/);
  });
});
