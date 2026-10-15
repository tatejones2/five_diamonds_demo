import type { FastifyPluginAsync } from 'fastify';
import { getPaymentProvider } from '../adapters/payments';
import { notFound } from '../lib/errors';
import { handleWebhook } from '../services/payments';

/** Provider callbacks need the exact raw body for signature verification. */
export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  app.post('/webhooks/payments/:provider', async (req) => {
    const provider = getPaymentProvider();
    const { provider: name } = req.params as { provider: string };
    if (!provider || provider.name !== name) throw notFound('Provider');
    return handleWebhook(provider, req.body as string, req.headers);
  });
};
