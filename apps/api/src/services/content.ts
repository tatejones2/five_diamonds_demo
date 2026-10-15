// Organization content (spec §12): draft → preview → publish with revision history.
// Bodies are Markdown rendered without raw HTML (ADR-010), so stored XSS is not possible.
import { and, asc, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { faqInput, newsPostInput, sponsorInput, staffProfileInput } from '@fd/shared';
import { db } from '../db/client';
import { contactSubmissions, contentPages, contentRevisions, faqs, newsPosts, sponsors, staffProfiles } from '../db/schema';
import { audit } from '../lib/audit';
import type { AuthedContext } from '../lib/context';
import { ApiError, notFound, versionConflict } from '../lib/errors';
import { uniqueViolation } from '../lib/pg';

/** Pages the site expects. Legal pages require owner approval before they display as final. */
export const PAGE_KEYS = {
  home_intro: { title: 'Home — introduction', legal: false },
  about: { title: 'About 5 Diamonds', legal: false },
  rules: { title: 'Rules', legal: false },
  get_involved: { title: 'Get Involved', legal: false },
  sponsorship: { title: 'Sponsorship', legal: false },
  media: { title: 'Photos & Video', legal: false },
  privacy: { title: 'Privacy Policy', legal: true },
  terms: { title: 'Terms of Use', legal: true },
  accessibility: { title: 'Accessibility', legal: true },
} as const;
export type PageKey = keyof typeof PAGE_KEYS;

export async function publicContent(kind: 'pages' | 'news' | 'sponsors' | 'staff' | 'faqs', key?: string) {
  switch (kind) {
    case 'pages': {
      if (!key) throw notFound('Page');
      const [p] = await db.select().from(contentPages).where(eq(contentPages.key, key));
      const meta = PAGE_KEYS[key as PageKey];
      if (!p || p.status !== 'published' || p.publishedBody === null || (meta?.legal && !p.ownerApproved)) {
        return { key, published: false, title: meta?.title ?? null, body: null, updatedAt: null, seoDescription: null };
      }
      return { key, published: true, title: p.publishedTitle ?? p.title, body: p.publishedBody, updatedAt: p.publishedAt?.toISOString() ?? null, seoDescription: p.seoDescription };
    }
    case 'news': {
      if (key) {
        const [n] = await db.select().from(newsPosts).where(and(eq(newsPosts.slug, key), eq(newsPosts.status, 'published')));
        if (!n) throw notFound('Article');
        return { slug: n.slug, title: n.publishedTitle ?? n.title, excerpt: n.excerpt, body: n.publishedBody, publishedAt: n.publishedAt?.toISOString() ?? null, isDemo: n.isDemo };
      }
      const rows = await db.select().from(newsPosts).where(eq(newsPosts.status, 'published')).orderBy(desc(newsPosts.publishedAt)).limit(50);
      return rows.map((n) => ({ slug: n.slug, title: n.publishedTitle ?? n.title, excerpt: n.excerpt, publishedAt: n.publishedAt?.toISOString() ?? null, isDemo: n.isDemo }));
    }
    case 'sponsors': {
      const rows = await db.select().from(sponsors).where(and(eq(sponsors.isPublished, true), eq(sponsors.ownerApproved, true))).orderBy(asc(sponsors.sortOrder));
      return rows.map((s) => ({ id: s.id, name: s.name, websiteUrl: s.websiteUrl, tier: s.tier, logoAssetId: s.logoAssetId }));
    }
    case 'staff': {
      const rows = await db.select().from(staffProfiles).where(eq(staffProfiles.isPublished, true)).orderBy(asc(staffProfiles.sortOrder));
      return rows.map((s) => ({
        id: s.id,
        name: s.name,
        title: s.title,
        bio: s.bio,
        // Contact details publish only with explicit permission (spec §3 staff migration).
        publicEmail: s.contactPublishingApproved ? s.publicEmail : null,
        publicPhone: s.contactPublishingApproved ? s.publicPhone : null,
      }));
    }
    case 'faqs': {
      const rows = await db.select().from(faqs).where(eq(faqs.isPublished, true)).orderBy(asc(faqs.sortOrder));
      return rows.map((f) => ({ id: f.id, question: f.question, answer: f.answer }));
    }
  }
}

// ---- Pages ------------------------------------------------------------------------------------

export async function adminPages() {
  const rows = await db.select().from(contentPages);
  return (Object.keys(PAGE_KEYS) as PageKey[]).map((key) => {
    const p = rows.find((r) => r.key === key);
    return {
      key,
      title: p?.title ?? PAGE_KEYS[key].title,
      legal: PAGE_KEYS[key].legal,
      draftBody: p?.draftBody ?? '',
      publishedBody: p?.publishedBody ?? null,
      status: p?.status ?? 'draft',
      ownerApproved: p?.ownerApproved ?? false,
      seoDescription: p?.seoDescription ?? null,
      version: p?.version ?? 0,
      publishedAt: p?.publishedAt?.toISOString() ?? null,
      updatedAt: p?.updatedAt.toISOString() ?? null,
      hasUnpublishedChanges: !!p && p.draftBody !== (p.publishedBody ?? ''),
    };
  });
}

export async function savePage(ctx: AuthedContext, key: string, input: { version: number; title: string; body: string; seoDescription: string | null }) {
  if (!(key in PAGE_KEYS)) throw notFound('Page');
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(contentPages).where(eq(contentPages.key, key)).for('update');
    if ((cur?.version ?? 0) !== input.version) throw versionConflict();
    let id: string;
    if (!cur) {
      const [p] = await tx.insert(contentPages).values({ key, title: input.title, draftBody: input.body, seoDescription: input.seoDescription, updatedBy: ctx.user.id, version: 1 }).returning();
      id = p!.id;
    } else {
      await tx
        .update(contentPages)
        .set({ title: input.title, draftBody: input.body, seoDescription: input.seoDescription, updatedBy: ctx.user.id, version: cur.version + 1, updatedAt: new Date() })
        .where(eq(contentPages.id, cur.id));
      id = cur.id;
    }
    await tx.insert(contentRevisions).values({ entityType: 'page', entityId: id, title: input.title, body: input.body, action: 'save', actorUserId: ctx.user.id });
  });
}

export async function publishPage(ctx: AuthedContext, key: string, input: { version: number; ownerApproved?: boolean }) {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(contentPages).where(eq(contentPages.key, key)).for('update');
    if (!cur) throw notFound('Page');
    if (cur.version !== input.version) throw versionConflict();
    const now = new Date();
    await tx
      .update(contentPages)
      .set({
        status: 'published',
        publishedBody: cur.draftBody,
        publishedTitle: cur.title,
        publishedAt: now,
        ownerApproved: input.ownerApproved ?? cur.ownerApproved,
        version: cur.version + 1,
        updatedAt: now,
      })
      .where(eq(contentPages.id, cur.id));
    await tx.insert(contentRevisions).values({ entityType: 'page', entityId: cur.id, title: cur.title, body: cur.draftBody, action: 'publish', actorUserId: ctx.user.id });
    await audit(tx, ctx, { action: 'content.publish_page', entityType: 'content_page', entityId: cur.id, summary: `${key}${input.ownerApproved ? ' (owner approved)' : ''}` });
  });
}

export async function revisions(entityType: 'page' | 'news', entityId: string) {
  return db.select().from(contentRevisions).where(and(eq(contentRevisions.entityType, entityType), eq(contentRevisions.entityId, entityId))).orderBy(desc(contentRevisions.createdAt)).limit(50);
}

// ---- News -------------------------------------------------------------------------------------

export async function adminNews() {
  return db.select().from(newsPosts).orderBy(desc(newsPosts.updatedAt));
}

export async function saveNews(ctx: AuthedContext, id: string | null, version: number | null, d: z.infer<typeof newsPostInput>) {
  return db.transaction(async (tx) => {
    try {
      if (!id) {
        const [n] = await tx.insert(newsPosts).values({ ...d, draftBody: d.body, authorUserId: ctx.user.id }).returning();
        await tx.insert(contentRevisions).values({ entityType: 'news', entityId: n!.id, title: d.title, body: d.body, action: 'save', actorUserId: ctx.user.id });
        return n!;
      }
      const [cur] = await tx.select().from(newsPosts).where(eq(newsPosts.id, id)).for('update');
      if (!cur) throw notFound('Article');
      if (cur.version !== version) throw versionConflict();
      const [n] = await tx
        .update(newsPosts)
        .set({ title: d.title, slug: d.slug, excerpt: d.excerpt, draftBody: d.body, tournamentId: d.tournamentId, version: cur.version + 1, updatedAt: new Date() })
        .where(eq(newsPosts.id, id))
        .returning();
      await tx.insert(contentRevisions).values({ entityType: 'news', entityId: id, title: d.title, body: d.body, action: 'save', actorUserId: ctx.user.id });
      return n!;
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError('CONFLICT', 'That URL slug is already in use.', { fields: { slug: 'Already in use' } });
      throw e;
    }
  });
}

export async function setNewsPublished(ctx: AuthedContext, id: string, version: number, publish: boolean) {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(newsPosts).where(eq(newsPosts.id, id)).for('update');
    if (!cur) throw notFound('Article');
    if (cur.version !== version) throw versionConflict();
    const now = new Date();
    await tx
      .update(newsPosts)
      .set(
        publish
          ? { status: 'published', publishedBody: cur.draftBody, publishedTitle: cur.title, publishedAt: cur.publishedAt ?? now, version: cur.version + 1, updatedAt: now }
          : { status: 'draft', version: cur.version + 1, updatedAt: now },
      )
      .where(eq(newsPosts.id, id));
    await tx.insert(contentRevisions).values({ entityType: 'news', entityId: id, title: cur.title, body: cur.draftBody, action: publish ? 'publish' : 'unpublish', actorUserId: ctx.user.id });
    await audit(tx, ctx, { action: publish ? 'news.publish' : 'news.unpublish', entityType: 'news', entityId: id, summary: cur.title });
  });
}

// ---- Simple collections -------------------------------------------------------------------------

export async function upsertSponsor(ctx: AuthedContext, id: string | null, d: z.infer<typeof sponsorInput>) {
  const [row] = id
    ? await db.update(sponsors).set({ ...d, updatedAt: new Date() }).where(eq(sponsors.id, id)).returning()
    : await db.insert(sponsors).values(d).returning();
  if (!row) throw notFound('Sponsor');
  await audit(db, ctx, { action: 'sponsor.save', entityType: 'sponsor', entityId: row.id, summary: `${d.name}${d.ownerApproved ? ' (approved)' : ''}` });
  return row;
}

export async function upsertStaffProfile(ctx: AuthedContext, id: string | null, d: z.infer<typeof staffProfileInput>) {
  const [row] = id
    ? await db.update(staffProfiles).set({ ...d, updatedAt: new Date() }).where(eq(staffProfiles.id, id)).returning()
    : await db.insert(staffProfiles).values(d).returning();
  if (!row) throw notFound('Staff profile');
  await audit(db, ctx, { action: 'staff_profile.save', entityType: 'staff_profile', entityId: row.id, summary: d.name });
  return row;
}

export async function upsertFaq(ctx: AuthedContext, id: string | null, d: z.infer<typeof faqInput>) {
  const [row] = id
    ? await db.update(faqs).set({ ...d, updatedAt: new Date() }).where(eq(faqs.id, id)).returning()
    : await db.insert(faqs).values(d).returning();
  if (!row) throw notFound('FAQ');
  await audit(db, ctx, { action: 'faq.save', entityType: 'faq', entityId: row.id });
  return row;
}

export async function listInquiries() {
  return db.select().from(contactSubmissions).orderBy(desc(contactSubmissions.createdAt)).limit(200);
}

export async function setInquiryStatus(ctx: AuthedContext, id: string, status: 'new' | 'in_progress' | 'closed' | 'spam') {
  const [row] = await db.update(contactSubmissions).set({ status, handledBy: ctx.user.id, updatedAt: new Date() }).where(eq(contactSubmissions.id, id)).returning();
  if (!row) throw notFound('Inquiry');
  await audit(db, ctx, { action: 'inquiry.status', entityType: 'contact_submission', entityId: id, summary: status });
  return row;
}
