import { contactSubmissionInput, tournamentListQuery, type MeResponse } from '@fd/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client';
import { contactSubmissions, type PublishedGameProjection } from '../db/schema';
import { getContext, isStaff } from '../lib/context';
import { parse } from '../lib/validate';
import { activeAlerts, announcementHistory } from '../services/announcements';
import { bracketView, listBrackets } from '../services/brackets';
import { publicContent } from '../services/content';
import {
  gameDay,
  getPublicTournament,
  getPublicTournamentRow,
  listPublicTournaments,
  publicGameLookups,
  publicSchedule,
  publicStandings,
  publicTeams,
  publicVenue,
  publicVenues,
  toPublicGame,
} from '../services/public';

const slugParam = z.object({ slug: z.string().min(1).max(120) });
const scheduleQuery = z.object({
  division: z.uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  team: z.uuid().optional(),
  field: z.uuid().optional(),
});

export const publicRoutes: FastifyPluginAsync = async (app) => {
  // Public data is cacheable briefly; clients poll with stale-while-revalidate (spec §11).
  app.addHook('onSend', async (req, reply) => {
    if (req.method === 'GET' && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });
  const publicCache = 'public, max-age=15, stale-while-revalidate=30';

  app.get('/me', async (req): Promise<MeResponse> => {
    const ctx = await getContext(req);
    return { user: ctx.user, roles: ctx.roles, isStaff: isStaff(ctx) };
  });

  app.get('/tournaments', async (req, reply) => {
    const q = parse(tournamentListQuery, req.query);
    reply.header('cache-control', publicCache);
    return listPublicTournaments(q);
  });

  app.get('/tournaments/:slug', async (req, reply) => {
    const { slug } = parse(slugParam, req.params);
    reply.header('cache-control', publicCache);
    return getPublicTournament(slug);
  });

  app.get('/tournaments/:slug/games', async (req, reply) => {
    const { slug } = parse(slugParam, req.params);
    reply.header('cache-control', publicCache);
    return publicSchedule(slug, parse(scheduleQuery, req.query));
  });

  app.get('/tournaments/:slug/teams', async (req, reply) => {
    const { slug } = parse(slugParam, req.params);
    reply.header('cache-control', publicCache);
    return publicTeams(slug);
  });

  app.get('/tournaments/:slug/standings', async (req, reply) => {
    const { slug } = parse(slugParam, req.params);
    reply.header('cache-control', publicCache);
    return publicStandings(slug);
  });

  app.get('/tournaments/:slug/brackets', async (req, reply) => {
    const { slug } = parse(slugParam, req.params);
    const t = await getPublicTournamentRow(slug);
    const list = await listBrackets(t.id, { publishedOnly: true });
    reply.header('cache-control', publicCache);
    return Promise.all(
      list.map(async (b) => {
        const view = await bracketView(
          b,
          (g) => g,
          { publicTeamNames: t.publicTeamNames },
        );
        // Map linked games to their *published* projection only.
        const pubs = view.matchups.map((m) => m.game).filter((g): g is NonNullable<typeof g> => !!g && !!g.published);
        const l = await publicGameLookups(t, pubs.map((g) => g.published as PublishedGameProjection));
        return {
          ...view,
          matchups: view.matchups.map(({ gameId: _gid, ...m }) => ({
            ...m,
            game: m.game?.published ? toPublicGame(m.game.id, m.game.published, m.game.publishedAt!, l) : null,
          })),
        };
      }),
    );
  });

  app.get('/tournaments/:slug/announcements', async (req, reply) => {
    const { slug } = parse(slugParam, req.params);
    const t = await getPublicTournamentRow(slug);
    reply.header('cache-control', publicCache);
    return { active: await activeAlerts(t.id), history: await announcementHistory(t.id) };
  });

  app.get('/alerts', async (_req, reply) => {
    reply.header('cache-control', publicCache);
    return activeAlerts(null);
  });

  app.get('/game-day', async (_req, reply) => {
    reply.header('cache-control', publicCache);
    return gameDay();
  });

  app.get('/facilities', async (_req, reply) => {
    reply.header('cache-control', publicCache);
    return (await publicVenues()).map((v) => ({ id: v.id, slug: v.slug, name: v.name, city: v.city, state: v.state, addressLine1: v.addressLine1, isDemo: v.isDemo }));
  });

  app.get('/facilities/:slug', async (req, reply) => {
    const { slug } = parse(slugParam, req.params);
    const v = await publicVenue(slug);
    reply.header('cache-control', publicCache);
    return {
      id: v.id, slug: v.slug, name: v.name, addressLine1: v.addressLine1, city: v.city, state: v.state, postalCode: v.postalCode,
      directions: v.directions, parking: v.parking, policies: v.policies, mapUrl: v.mapUrl, isDemo: v.isDemo, fields: v.fields,
    };
  });

  app.get('/content/:kind', async (req, reply) => {
    const { kind } = parse(z.object({ kind: z.enum(['pages', 'news', 'sponsors', 'staff', 'faqs']) }), req.params);
    const { key } = parse(z.object({ key: z.string().max(120).optional() }), req.query);
    reply.header('cache-control', publicCache);
    return publicContent(kind, key);
  });

  app.post(
    '/contact',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const input = parse(contactSubmissionInput, req.body);
      // Honeypot: pretend success so bots learn nothing; store nothing.
      if (input.website) return reply.status(202).send({ ok: true });
      await db.insert(contactSubmissions).values({ name: input.name, email: input.email, phone: input.phone, topic: input.topic, message: input.message });
      return reply.status(202).send({ ok: true });
    },
  );
};
