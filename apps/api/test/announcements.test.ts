import { beforeAll, describe, expect, it } from 'vitest';
import { anon, expectStatus, freshDb, json, makeTeam, makeUser, register, setupTournament, type Client } from './helpers';

let director: Client;
beforeAll(async () => {
  await freshDb();
  director = await makeUser({ roles: [{ role: 'tournament_director' }], name: 'Jordan Director' });
});

describe('weather notices (spec §16 director 7)', () => {
  it('publishes a thunderstorm delay with affected games, history, author and all-clear', async () => {
    const s = await setupTournament(director, { capacity: 2 });
    const m1 = await makeUser();
    const m2 = await makeUser();
    const a = await makeTeam(m1, 'Hawks');
    const b = await makeTeam(m2, 'Owls');
    expectStatus(await register(m1, s.divisionId, a.id), 201);
    expectStatus(await register(m2, s.divisionId, b.id), 201);
    // Manager 2 opts in to event emails.
    expectStatus(await m2.put('/api/me/notification-preferences', { emailRegistrationUpdates: true, emailEventNotices: true }), 200);
    const g = json(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/draft`, { divisionId: s.divisionId, stage: 'pool', fieldId: s.fieldIds[0], date: '2030-04-18', time: '09:00', durationMinutes: 90, homeTeamId: a.id, awayTeamId: b.id }));
    const p = json(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/validate`));
    expectStatus(await director.post(`/api/admin/tournaments/${s.t.id}/schedule/publish`, { previewToken: p.token }), 200);

    const draft = json(expectStatus(await director.post('/api/admin/announcements', {
      tournamentId: s.t.id, scope: 'field', scopeId: s.fieldIds[0], severity: 'critical', category: 'weather_delay',
      title: 'Thunderstorm delay', body: 'Lightning in the area. All games on Field 1 are delayed at least 30 minutes.', affectedGameIds: [g.id],
    }), 201));
    // Drafts are not public.
    expect(json(await anon.get(`/api/tournaments/${s.t.slug}/announcements`)).active).toEqual([]);

    expectStatus(await director.post(`/api/admin/announcements/${draft.id}/action`, { version: draft.version, action: 'publish' }), 200);
    // Reschedule the affected game, with a reason.
    expectStatus(await director.patch(`/api/admin/games/${g.id}`, { version: g.version, status: 'delayed', resultType: 'played', homeScore: null, awayScore: null, forfeitWinner: null, time: '10:00', reason: 'Thunderstorm delay' }), 200);

    const detail = json(await anon.get(`/api/tournaments/${s.t.slug}`));
    expect(detail.activeAlerts).toHaveLength(1);
    const alert = detail.activeAlerts[0];
    expect(alert.severity).toBe('critical');
    expect(alert.scopeLabel).toBe('Test Park — Field 1');
    expect(alert.affectedGameIds).toEqual([g.id]);
    expect(alert.authorName).toBe('Jordan');

    const sched = json(await anon.get(`/api/tournaments/${s.t.slug}/games`));
    expect(sched.games[0].status).toBe('delayed');

    const audit = json(await director.get(`/api/admin/audit-events?tournamentId=${s.t.id}`)).items;
    const pub = audit.find((e: any) => e.action === 'announcement.publish');
    expect(pub.actor.id).toBe(director.userId);

    // Only the opted-in manager was emailed.
    const box2 = json(await anon.get(`/api/dev/mailbox?to=${encodeURIComponent(m2.email)}`));
    expect(box2.some((m: any) => m.template === 'event_notice')).toBe(true);
    const box1 = json(await anon.get(`/api/dev/mailbox?to=${encodeURIComponent(m1.email)}`));
    expect(box1.some((m: any) => m.template === 'event_notice')).toBe(false);

    const live = json(await director.get(`/api/admin/announcements?tournamentId=${s.t.id}`))[0];
    expectStatus(await director.post(`/api/admin/announcements/${draft.id}/action`, { version: live.version, action: 'all_clear', message: 'Storm passed. Play resumes 10:00.' }), 200);
    const after = json(await anon.get(`/api/tournaments/${s.t.slug}/announcements`));
    expect(after.active).toEqual([]);
    expect(after.history[0].status).toBe('all_clear');
    expect(after.history[0].allClearMessage).toContain('Storm passed');
  });

  it('rejects scopes outside the tournament and expired notices are not active', async () => {
    const s = await setupTournament(director);
    const other = await setupTournament(director);
    const bad = await director.post('/api/admin/announcements', { tournamentId: s.t.id, scope: 'field', scopeId: other.fieldIds[0], severity: 'info', category: 'general', title: 'x', body: 'y' });
    expect(bad.statusCode).toBe(400);
    const exp = json(await director.post('/api/admin/announcements', { tournamentId: s.t.id, scope: 'tournament', scopeId: null, severity: 'info', category: 'general', title: 'Old', body: 'y', effectiveAt: '2020-01-01T00:00:00Z', expiresAt: '2020-01-02T00:00:00Z' }));
    expectStatus(await director.post(`/api/admin/announcements/${exp.id}/action`, { version: exp.version, action: 'publish' }), 200);
    expect(json(await anon.get(`/api/tournaments/${s.t.slug}`)).activeAlerts).toEqual([]);
  });
});
