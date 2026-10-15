import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { db } from '../src/db/client';
import { resetDatabase } from '../src/db/reset';
import { roleAssignments, user } from '../src/db/schema';
import type { StaffRole } from '@fd/shared';

export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'correct-horse-battery';

let app: FastifyInstance | null = null;
export async function getApp() {
  app ??= await buildApp();
  return app;
}

export async function freshDb() {
  await resetDatabase();
}

export interface Client {
  cookie: string;
  userId: string;
  email: string;
  get: (url: string) => Promise<LightMyRequestResponse>;
  post: (url: string, body?: unknown) => Promise<LightMyRequestResponse>;
  patch: (url: string, body?: unknown) => Promise<LightMyRequestResponse>;
  put: (url: string, body?: unknown) => Promise<LightMyRequestResponse>;
  del: (url: string) => Promise<LightMyRequestResponse>;
}

export function cookiesFrom(res: LightMyRequestResponse) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

export async function request(method: string, url: string, body?: unknown, cookie = '') {
  const a = await getApp();
  return a.inject({
    method: method as 'GET',
    url,
    headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export const anon = {
  get: (url: string) => request('GET', url),
  post: (url: string, body?: unknown) => request('POST', url, body),
};

export function clientFor(cookie: string, userId: string, email: string): Client {
  return {
    cookie,
    userId,
    email,
    get: (url) => request('GET', url, undefined, cookie),
    post: (url, body) => request('POST', url, body ?? {}, cookie),
    patch: (url, body) => request('PATCH', url, body ?? {}, cookie),
    put: (url, body) => request('PUT', url, body ?? {}, cookie),
    del: (url) => request('DELETE', url, undefined, cookie),
  };
}

let counter = 0;
/** Create a verified account (verification itself is covered in auth.test.ts) and sign in. */
export async function makeUser(opts: { roles?: { role: StaffRole; tournamentId?: string | null }[]; name?: string } = {}): Promise<Client> {
  const email = `user${Date.now()}${counter++}@test.invalid`;
  const res = await request('POST', '/api/auth/sign-up/email', { email, password: PASSWORD, name: opts.name ?? 'Test User' });
  if (res.statusCode !== 200) throw new Error(`sign-up failed ${res.statusCode} ${res.body}`);
  await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  for (const r of opts.roles ?? []) await db.insert(roleAssignments).values({ userId: u!.id, role: r.role, tournamentId: r.tournamentId ?? null });
  const login = await request('POST', '/api/auth/sign-in/email', { email, password: PASSWORD });
  if (login.statusCode !== 200) throw new Error(`sign-in failed ${login.statusCode} ${login.body}`);
  return clientFor(cookiesFrom(login), u!.id, email);
}

export async function grant(c: Client, role: StaffRole, tournamentId: string | null = null) {
  await db.insert(roleAssignments).values({ userId: c.userId, role, tournamentId });
}

export const json = <T = any>(r: LightMyRequestResponse) => r.json() as T;

export function expectStatus(r: LightMyRequestResponse, status: number) {
  if (r.statusCode !== status) throw new Error(`Expected ${status}, got ${r.statusCode}: ${r.body}`);
  return r;
}

// ---- Fixtures --------------------------------------------------------------------------------

export function tournamentBody(over: Record<string, unknown> = {}) {
  const slug = `t-${Date.now()}-${counter++}`;
  return {
    title: 'Test Tournament',
    slug,
    startsOn: '2030-04-18',
    endsOn: '2030-04-19',
    reviewMode: 'auto_confirm',
    waitlistEnabled: true,
    venueIds: [],
    ...over,
  };
}

export const divisionBody = (over: Record<string, unknown> = {}) => ({ name: '10U', ageLabel: '10U', capacity: 4, rosterMax: 15, ...over });

/** Director-created, published tournament with one division, one venue with two fields. */
export async function setupTournament(director: Client, opts: { capacity?: number; reviewMode?: string; venue?: boolean } = {}) {
  let venueId: string | undefined;
  let fieldIds: string[] = [];
  if (opts.venue !== false) {
    const v = json(expectStatus(await director.post('/api/admin/venues', { name: 'Test Park', slug: `park-${Date.now()}-${counter++}`, isPublished: true }), 201));
    venueId = v.id;
    for (const n of ['Field 1', 'Field 2']) fieldIds.push(json(expectStatus(await director.post(`/api/admin/venues/${v.id}/fields`, { name: n }), 201)).id);
  }
  let t = json(expectStatus(await director.post('/api/admin/tournaments', tournamentBody({ reviewMode: opts.reviewMode ?? 'auto_confirm', venueIds: venueId ? [venueId] : [] })), 201));
  t = json(expectStatus(await director.post(`/api/admin/tournaments/${t.id}/divisions`, divisionBody({ capacity: opts.capacity ?? 4 })), 201));
  t = json(expectStatus(await director.post(`/api/admin/tournaments/${t.id}/transition`, { version: t.version, to: 'published_open' }), 200));
  return { t, divisionId: t.divisions[0].id as string, fieldIds, venueId };
}

export async function makeTeam(c: Client, name = 'Test Team') {
  return json(expectStatus(await c.post('/api/me/teams', { name, ageGroup: '10U' }), 201));
}

export async function register(c: Client, divisionId: string, teamId: string, joinWaitlistIfFull = false) {
  return c.post('/api/registrations', { divisionId, teamId, joinWaitlistIfFull, acknowledgeRules: true });
}
