import { contentPageInput, faqInput, newsPostInput, sponsorInput, staffProfileInput } from '@fd/shared';
import { asc } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client';
import { faqs, sponsors, staffProfiles } from '../db/schema';
import { requireStaff } from '../lib/context';
import { assert, canEditContent, canEditNews } from '../lib/policy';
import { parse } from '../lib/validate';
import {
  adminNews,
  adminPages,
  listInquiries,
  publishPage,
  revisions,
  saveNews,
  savePage,
  setInquiryStatus,
  setNewsPublished,
  upsertFaq,
  upsertSponsor,
  upsertStaffProfile,
} from '../services/content';

const idParam = z.object({ id: z.uuid() });
const keyParam = z.object({ key: z.string().regex(/^[a-z_]+$/).max(40) });

export const adminContentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });

  const editor = async (req: FastifyRequest) => {
    const ctx = await requireStaff(req);
    assert(canEditContent(ctx), 'Content editor access required.');
    return ctx;
  };

  // Pages
  app.get('/content/pages', async (req) => {
    await editor(req);
    return adminPages();
  });
  app.put('/content/pages/:key', async (req) => {
    const ctx = await editor(req);
    await savePage(ctx, parse(keyParam, req.params).key, parse(contentPageInput, req.body));
    return adminPages();
  });
  app.post('/content/pages/:key/publish', async (req) => {
    const ctx = await editor(req);
    await publishPage(ctx, parse(keyParam, req.params).key, parse(z.object({ version: z.number().int(), ownerApproved: z.boolean().optional() }), req.body));
    return adminPages();
  });
  app.get('/content/revisions/:type/:id', async (req) => {
    await editor(req);
    const p = parse(z.object({ type: z.enum(['page', 'news']), id: z.uuid() }), req.params);
    return revisions(p.type, p.id);
  });

  // News
  app.get('/news', async (req) => {
    const ctx = await requireStaff(req);
    assert(canEditNews(ctx));
    return adminNews();
  });
  app.post('/news', async (req, reply) => {
    const ctx = await requireStaff(req);
    assert(canEditNews(ctx));
    return reply.status(201).send(await saveNews(ctx, null, null, parse(newsPostInput, req.body)));
  });
  app.patch('/news/:id', async (req) => {
    const ctx = await requireStaff(req);
    assert(canEditNews(ctx));
    const { version, data } = parse(z.object({ version: z.number().int(), data: newsPostInput }), req.body);
    return saveNews(ctx, parse(idParam, req.params).id, version, data);
  });
  app.post('/news/:id/publish', async (req) => {
    const ctx = await requireStaff(req);
    assert(canEditNews(ctx));
    const body = parse(z.object({ version: z.number().int(), publish: z.boolean() }), req.body);
    await setNewsPublished(ctx, parse(idParam, req.params).id, body.version, body.publish);
    return { ok: true };
  });

  // Sponsors / partners
  app.get('/sponsors', async (req) => {
    await editor(req);
    return db.select().from(sponsors).orderBy(asc(sponsors.sortOrder));
  });
  app.post('/sponsors', async (req, reply) => reply.status(201).send(await upsertSponsor(await editor(req), null, parse(sponsorInput, req.body))));
  app.patch('/sponsors/:id', async (req) => upsertSponsor(await editor(req), parse(idParam, req.params).id, parse(sponsorInput, req.body)));

  // Staff profiles (public staff page)
  app.get('/staff-profiles', async (req) => {
    await editor(req);
    return db.select().from(staffProfiles).orderBy(asc(staffProfiles.sortOrder));
  });
  app.post('/staff-profiles', async (req, reply) => reply.status(201).send(await upsertStaffProfile(await editor(req), null, parse(staffProfileInput, req.body))));
  app.patch('/staff-profiles/:id', async (req) => upsertStaffProfile(await editor(req), parse(idParam, req.params).id, parse(staffProfileInput, req.body)));

  // FAQs
  app.get('/faqs', async (req) => {
    await editor(req);
    return db.select().from(faqs).orderBy(asc(faqs.sortOrder));
  });
  app.post('/faqs', async (req, reply) => reply.status(201).send(await upsertFaq(await editor(req), null, parse(faqInput, req.body))));
  app.patch('/faqs/:id', async (req) => upsertFaq(await editor(req), parse(idParam, req.params).id, parse(faqInput, req.body)));

  // Inquiries (contact form)
  app.get('/inquiries', async (req) => {
    await editor(req);
    return listInquiries();
  });
  app.post('/inquiries/:id/status', async (req) => {
    const ctx = await editor(req);
    const { status } = parse(z.object({ status: z.enum(['new', 'in_progress', 'closed', 'spam']) }), req.body);
    return setInquiryStatus(ctx, parse(idParam, req.params).id, status);
  });
};
