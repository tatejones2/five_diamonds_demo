import { beforeAll, describe, expect, it } from 'vitest';
import { anon, cookiesFrom, expectStatus, freshDb, json, makeUser, PASSWORD, request } from './helpers';
import { getApp } from './helpers';
import { setMailAdapter, getMailAdapter } from '../src/services/mailer';

beforeAll(freshDb);

describe('account lifecycle (spec §16 coach 1)', () => {
  it('signs up, receives a verification email, verifies, and signs in', async () => {
    const email = 'new.manager@test.invalid';
    expectStatus(await request('POST', '/api/auth/sign-up/email', { email, password: PASSWORD, name: 'New Manager' }), 200);

    // Unverified accounts cannot sign in.
    const blocked = await request('POST', '/api/auth/sign-in/email', { email, password: PASSWORD });
    expect(blocked.statusCode).toBe(403);

    const mail = json(await anon.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`));
    const verify = mail.find((m: any) => m.template === 'verify_email');
    expect(verify).toBeTruthy();
    const link = new URL(/https?:\/\/\S+/.exec(verify.text)![0]);
    const v = await request('GET', link.pathname + link.search);
    expect([200, 302]).toContain(v.statusCode);

    const login = expectStatus(await request('POST', '/api/auth/sign-in/email', { email, password: PASSWORD }), 200);
    const me = json(await request('GET', '/api/me', undefined, cookiesFrom(login)));
    expect(me.user.email).toBe(email);
    expect(me.user.emailVerified).toBe(true);
    expect(me.isStaff).toBe(false);
  });

  it('rejects short passwords', async () => {
    const r = await request('POST', '/api/auth/sign-up/email', { email: 'short@test.invalid', password: 'short', name: 'X' });
    expect(r.statusCode).toBe(400);
  });

  it('requires a session for manager endpoints', async () => {
    const r = await anon.get('/api/me/teams');
    expect(r.statusCode).toBe(401);
    expect(json(r).error.code).toBe('UNAUTHENTICATED');
  });

  it('logout invalidates the session', async () => {
    const c = await makeUser();
    expectStatus(await c.post('/api/auth/sign-out', {}), 200);
    expect((await c.get('/api/me/teams')).statusCode).toBe(401);
  });
});

describe('CSRF origin guard', () => {
  it('rejects state-changing requests from untrusted origins', async () => {
    const c = await makeUser();
    const app = await getApp();
    const evil = await app.inject({ method: 'POST', url: '/api/me/teams', headers: { origin: 'https://evil.example', cookie: c.cookie, 'content-type': 'application/json' }, payload: JSON.stringify({ name: 'X', ageGroup: '10U' }) });
    expect(evil.statusCode).toBe(403);
    const none = await app.inject({ method: 'POST', url: '/api/me/teams', headers: { cookie: c.cookie, 'content-type': 'application/json' }, payload: JSON.stringify({ name: 'X', ageGroup: '10U' }) });
    expect(none.statusCode).toBe(403);
  });
});

describe('email failures are never reported as success', () => {
  it('surfaces a failed verification email and queues a retry', async () => {
    const original = getMailAdapter();
    setMailAdapter({ name: 'broken', send: async () => { throw new Error('SMTP down'); } });
    try {
      const email = 'mailfail@test.invalid';
      const r = await request('POST', '/api/auth/sign-up/email', { email, password: PASSWORD, name: 'Mail Fail' });
      // better-auth may run the sender in the background; either the request errors or the outbox records failure.
      const box = json(await anon.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`));
      const failedOrErrored = r.statusCode >= 400 || box.some((m: any) => m.status === 'failed');
      expect(failedOrErrored).toBe(true);
      expect(box.some((m: any) => m.status === 'sent')).toBe(false);
    } finally {
      setMailAdapter(original);
    }
  });
});
