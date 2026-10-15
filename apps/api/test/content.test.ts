import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/client';
import { contactSubmissions } from '../src/db/schema';
import { anon, expectStatus, freshDb, getApp, json, makeUser, type Client } from './helpers';

let editor: Client;
beforeAll(async () => {
  await freshDb();
  editor = await makeUser({ roles: [{ role: 'content_editor' }] });
});

describe('CMS draft/publish (spec §12)', () => {
  it('keeps drafts private and publishes with revision history', async () => {
    expectStatus(await editor.put('/api/admin/content/pages/about', { version: 0, title: 'About', body: 'Draft text', seoDescription: null }), 200);
    expect(json(await anon.get('/api/content/pages?key=about')).published).toBe(false);
    expectStatus(await editor.post('/api/admin/content/pages/about/publish', { version: 1 }), 200);
    const pub = json(await anon.get('/api/content/pages?key=about'));
    expect(pub.body).toBe('Draft text');
    // Further drafts do not change the public page until republished.
    const pages = json(await editor.get('/api/admin/content/pages'));
    const about = pages.find((p: any) => p.key === 'about');
    expectStatus(await editor.put('/api/admin/content/pages/about', { version: about.version, title: 'About', body: 'Edited', seoDescription: null }), 200);
    expect(json(await anon.get('/api/content/pages?key=about')).body).toBe('Draft text');
  });

  it('legal pages stay unpublished publicly until owner-approved', async () => {
    expectStatus(await editor.put('/api/admin/content/pages/privacy', { version: 0, title: 'Privacy', body: 'Policy', seoDescription: null }), 200);
    expectStatus(await editor.post('/api/admin/content/pages/privacy/publish', { version: 1 }), 200);
    expect(json(await anon.get('/api/content/pages?key=privacy')).published).toBe(false);
    expectStatus(await editor.post('/api/admin/content/pages/privacy/publish', { version: 2, ownerApproved: true }), 200);
    expect(json(await anon.get('/api/content/pages?key=privacy')).published).toBe(true);
  });

  it('partners need publish AND owner approval; staff contacts need permission', async () => {
    expectStatus(await editor.post('/api/admin/sponsors', { name: 'Unapproved Co', isPublished: true, ownerApproved: false }), 201);
    expectStatus(await editor.post('/api/admin/sponsors', { name: 'Approved Co', isPublished: true, ownerApproved: true }), 201);
    expect(json(await anon.get('/api/content/sponsors')).map((s: any) => s.name)).toEqual(['Approved Co']);
    expectStatus(await editor.post('/api/admin/staff-profiles', { name: 'Pat Example', title: 'Director', publicEmail: 'pat@example.invalid', publicPhone: '555-0199', isPublished: true, contactPublishingApproved: false }), 201);
    const staff = json(await anon.get('/api/content/staff'));
    expect(staff[0].publicEmail).toBeNull();
    expect(staff[0].publicPhone).toBeNull();
  });

  it('managers cannot edit content', async () => {
    const m = await makeUser();
    expect((await m.put('/api/admin/content/pages/about', { version: 0, title: 'x', body: 'y' })).statusCode).toBe(403);
  });
});

describe('contact form (spec §12)', () => {
  it('stores real submissions privately and silently drops honeypot hits', async () => {
    const body = { name: 'Parent Example', email: 'parent@example.invalid', topic: 'general', message: 'Hello' };
    expectStatus(await anon.post('/api/contact', body), 202);
    expectStatus(await anon.post('/api/contact', { ...body, message: 'spam', website: 'http://spam' }), 202);
    const rows = await db.select().from(contactSubmissions);
    expect(rows.map((r) => r.message)).toEqual(['Hello']);
    expect((await anon.get('/api/admin/inquiries')).statusCode).toBe(401);
    expect(json(await editor.get('/api/admin/inquiries'))).toHaveLength(1);
  });
});

describe('SEO', () => {
  it('sitemap lists only public URLs', async () => {
    const app = await getApp();
    const r = await app.inject({ method: 'GET', url: '/sitemap.xml' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<loc>http://localhost:5173/tournaments</loc>');
    expect(r.body).not.toMatch(/dashboard|admin|auth/);
  });
});
