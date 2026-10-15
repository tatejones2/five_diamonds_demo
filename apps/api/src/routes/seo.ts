import { PUBLIC_TOURNAMENT_STATUSES } from '@fd/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config';
import { db } from '../db/client';
import { newsPosts, tournaments, venues } from '../db/schema';

const STATIC = ['/', '/tournaments', '/game-day', '/facilities', '/news', '/about', '/staff', '/rules', '/faq', '/media', '/partners', '/sponsorship', '/get-involved', '/contact'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Public, published URLs only. Private areas are excluded here and disallowed in robots.txt. */
export const seoRoutes: FastifyPluginAsync = async (app) => {
  app.get('/sitemap.xml', async (_req, reply) => {
    const ts = await db.select({ slug: tournaments.slug, updatedAt: tournaments.updatedAt }).from(tournaments).where(inArray(tournaments.status, [...PUBLIC_TOURNAMENT_STATUSES]));
    const news = await db.select({ slug: newsPosts.slug, updatedAt: newsPosts.updatedAt }).from(newsPosts).where(eq(newsPosts.status, 'published'));
    const vs = await db.select({ slug: venues.slug, updatedAt: venues.updatedAt }).from(venues).where(and(eq(venues.isPublished, true)));
    const urls: { loc: string; lastmod?: Date }[] = [
      ...STATIC.map((p) => ({ loc: p })),
      ...ts.flatMap((t) => ['', '/schedule', '/brackets', '/standings', '/updates'].map((s) => ({ loc: `/tournaments/${t.slug}${s}`, lastmod: t.updatedAt }))),
      ...news.map((n) => ({ loc: `/news/${n.slug}`, lastmod: n.updatedAt })),
      ...vs.map((v) => ({ loc: `/facilities/${v.slug}`, lastmod: v.updatedAt })),
    ];
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${esc(config.APP_ORIGIN + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}</url>`)
      .join('\n')}\n</urlset>\n`;
    return reply.header('content-type', 'application/xml; charset=utf-8').header('cache-control', 'public, max-age=3600').send(body);
  });
};
