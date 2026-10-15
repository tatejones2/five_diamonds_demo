import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ROSTER_FILE_MAX_BYTES } from '@fd/shared';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { auth } from './auth';
import { config, isTest, trustedOrigins } from './config';
import { db } from './db/client';
import { ApiError } from './lib/errors';
import { loggerOptions } from './lib/logger';
import { adminContentRoutes } from './routes/admin-content';
import { adminOpsRoutes } from './routes/admin-ops';
import { adminTournamentRoutes } from './routes/admin-tournaments';
import { devRoutes } from './routes/dev';
import { meRoutes } from './routes/me';
import { publicRoutes } from './routes/public';
import { seoRoutes } from './routes/seo';
import { webhookRoutes } from './routes/webhooks';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  await app.register(rateLimit, {
    global: true,
    max: isTest ? 100_000 : 300,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } }),
  });
  await app.register(multipart, { limits: { fileSize: ROSTER_FILE_MAX_BYTES, files: 1, fields: 5 } });

  // CSRF defence for cookie sessions (ADR-006): unsafe methods must come from a trusted origin.
  app.addHook('onRequest', async (req) => {
    if (SAFE_METHODS.has(req.method) || !req.url.startsWith('/api/')) return;
    if (req.url.startsWith('/api/webhooks/')) return; // verified by signature instead
    const origin = req.headers.origin ?? (req.headers.referer ? new URL(req.headers.referer).origin : undefined);
    if (!origin || !trustedOrigins.includes(origin)) {
      throw new ApiError('FORBIDDEN', 'Request origin not allowed.');
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode === 429) {
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } });
    }
    if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.code === 'FST_FILES_LIMIT') {
      return reply.status(422).send({ error: { code: 'FILE_REJECTED', message: 'That file is too large. The limit is 256 KB.' } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: 'VALIDATION_FAILED', message: e.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
  });

  app.get('/api/health', async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });

  // better-auth handler, bridged from Fastify to the Fetch API.
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    config: { rateLimit: { max: isTest ? 100_000 : 60, timeWindow: '1 minute' } },
    async handler(req, reply) {
      const url = new URL(req.url, config.APP_ORIGIN);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
        else headers.set(k, String(v));
      }
      headers.set('x-forwarded-for', req.ip);
      const request = new Request(url, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.body === undefined ? undefined : JSON.stringify(req.body),
      });
      const res = await auth.handler(request);
      reply.status(res.status);
      res.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value);
      });
      const cookies = res.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(res.body ? await res.text() : null);
    },
  });

  await app.register(seoRoutes);
  await app.register(webhookRoutes, { prefix: '/api' });
  await app.register(publicRoutes, { prefix: '/api' });
  await app.register(meRoutes, { prefix: '/api' });
  await app.register(adminTournamentRoutes, { prefix: '/api/admin' });
  await app.register(adminOpsRoutes, { prefix: '/api/admin' });
  await app.register(adminContentRoutes, { prefix: '/api/admin' });
  if (config.NODE_ENV !== 'production') await app.register(devRoutes, { prefix: '/api/dev' });

  return app;
}
