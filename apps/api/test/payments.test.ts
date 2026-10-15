import { beforeAll, describe, expect, it } from 'vitest';
import { expectStatus, freshDb, getApp, json, makeTeam, makeUser, register, setupTournament, type Client } from './helpers';
import { signSimulatedPayload } from '../src/adapters/payments';

let director: Client;
beforeAll(async () => {
  await freshDb();
  director = await makeUser({ roles: [{ role: 'tournament_director' }] });
});

describe('payment boundary (spec §7)', () => {
  it('only a verified callback marks a registration paid; staff cannot fake it', async () => {
    const s = await setupTournament(director);
    const t = json(await director.get(`/api/admin/tournaments/${s.t.id}`));
    const { divisions, counts, id, version, status, isDemo, publishedAt, createdAt, updatedAt, ...data } = t;
    expectStatus(await director.patch(`/api/admin/tournaments/${s.t.id}`, { version, data: { ...data, paymentRequired: true } }), 200);
    const m = await makeUser();
    const reg = json(expectStatus(await register(m, s.divisionId, (await makeTeam(m)).id), 201)).registration;
    expect(reg.paymentStatus).toBe('not_started');

    const co = json(expectStatus(await m.post(`/api/me/registrations/${reg.id}/checkout`), 200));
    expect(co.provider).toMatch(/SIMULATED/);
    const ref = new URL(co.checkoutUrl).searchParams.get('ref')!;
    expect(json(await m.get(`/api/me/registrations/${reg.id}`)).paymentStatus).toBe('pending_external');

    const app = await getApp();
    const raw = JSON.stringify({ providerEventId: 'evt_1', providerReference: ref, type: 'payment.succeeded' });
    const forged = await app.inject({ method: 'POST', url: '/api/webhooks/payments/simulated', headers: { 'content-type': 'application/json', 'x-simulated-signature': 'a'.repeat(64) }, payload: raw });
    expect(forged.statusCode).toBe(403);
    expect(json(await m.get(`/api/me/registrations/${reg.id}`)).paymentStatus).toBe('pending_external');

    const ok = await app.inject({ method: 'POST', url: '/api/webhooks/payments/simulated', headers: { 'content-type': 'application/json', 'x-simulated-signature': signSimulatedPayload(raw) }, payload: raw });
    expect(ok.statusCode).toBe(200);
    const replay = await app.inject({ method: 'POST', url: '/api/webhooks/payments/simulated', headers: { 'content-type': 'application/json', 'x-simulated-signature': signSimulatedPayload(raw) }, payload: raw });
    expect(json(replay).duplicate).toBe(true);
    const paid = json(await m.get(`/api/me/registrations/${reg.id}`));
    expect(paid.paymentStatus).toBe('paid_verified');

    const fake = await director.post(`/api/admin/registrations/${reg.id}/payment-status`, { version: paid.version, to: 'paid_verified', reason: 'trust me' });
    expect(fake.statusCode).toBe(400);
    expectStatus(await director.post(`/api/admin/registrations/${reg.id}/payment-status`, { version: paid.version, to: 'refunded', reason: 'Team withdrew' }), 200);
  });
});
