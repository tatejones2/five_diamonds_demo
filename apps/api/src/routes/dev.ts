// Development-only helpers. Not registered when NODE_ENV=production (see app.ts).
import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { signSimulatedPayload } from '../adapters/payments';
import { db } from '../db/client';
import { notificationDeliveries } from '../db/schema';
import { parse } from '../lib/validate';

export const devRoutes: FastifyPluginAsync = async (app) => {
  /** Dev mailbox: lets developers and E2E tests read verification/reset emails. */
  app.get('/mailbox', async (req) => {
    const { to } = parse(z.object({ to: z.email() }), req.query);
    return db
      .select({ id: notificationDeliveries.id, subject: notificationDeliveries.subject, text: notificationDeliveries.textBody, status: notificationDeliveries.status, createdAt: notificationDeliveries.createdAt, template: notificationDeliveries.template })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.toAddress, to.toLowerCase()))
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(20);
  });

  /** Simulated provider "completes" a checkout by sending itself a signed webhook. */
  app.post('/simulated-payment', async (req) => {
    const body = parse(z.object({ providerReference: z.string().startsWith('sim_'), outcome: z.enum(['payment.succeeded', 'payment.failed']) }), req.body);
    const raw = JSON.stringify({ providerEventId: `evt_${crypto.randomUUID()}`, providerReference: body.providerReference, type: body.outcome });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/payments/simulated',
      headers: { 'content-type': 'application/json', 'x-simulated-signature': signSimulatedPayload(raw) },
      payload: raw,
    });
    return { status: res.statusCode, body: res.json() };
  });
};
