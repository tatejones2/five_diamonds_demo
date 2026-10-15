import type { PaymentStatus } from '@fd/shared';
import { and, eq } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { paymentAttempts, paymentEvents, registrations, teams } from '../db/schema';
import { getPaymentProvider, type PaymentProviderAdapter } from '../adapters/payments';
import type { AuthedContext } from '../lib/context';
import { ApiError, notFound } from '../lib/errors';
import { uniqueViolation } from '../lib/pg';

const STARTABLE: PaymentStatus[] = ['not_started', 'failed'];

export async function startCheckout(ctx: AuthedContext, registrationId: string) {
  const provider = getPaymentProvider();
  if (!provider) {
    throw new ApiError('CONFLICT', "Online payment isn't available yet. The tournament director will confirm payment arrangements with you.");
  }
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select({ reg: registrations })
      .from(registrations)
      .innerJoin(teams, eq(teams.id, registrations.teamId))
      .where(and(eq(registrations.id, registrationId), eq(teams.ownerUserId, ctx.user.id)))
      .for('update');
    if (!r) throw notFound('Registration');
    if (!STARTABLE.includes(r.reg.paymentStatus)) throw new ApiError('CONFLICT', 'Payment for this registration is already in progress or complete.');
    if (!['confirmed', 'pending_review'].includes(r.reg.status)) throw new ApiError('CONFLICT', 'Payment opens once your spot is held or confirmed.');
    // Idempotency: one attempt per registration per payment-status version.
    const idempotencyKey = `checkout:${r.reg.id}:${r.reg.version}`;
    const [existing] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.idempotencyKey, idempotencyKey));
    if (existing?.checkoutUrl) return { checkoutUrl: existing.checkoutUrl, provider: provider.label };
    const session = await provider.createCheckout({
      registrationId: r.reg.id,
      referenceCode: r.reg.referenceCode,
      amountCents: null,
      idempotencyKey,
      returnUrl: `${config.APP_ORIGIN}/dashboard/registrations/${r.reg.id}`,
    });
    const [attempt] = await tx
      .insert(paymentAttempts)
      .values({ registrationId: r.reg.id, provider: provider.name, providerReference: session.providerReference, idempotencyKey, status: 'pending_external', checkoutUrl: session.checkoutUrl, createdBy: ctx.user.id })
      .returning();
    await tx.update(registrations).set({ paymentStatus: 'pending_external', version: r.reg.version + 1, updatedAt: new Date() }).where(eq(registrations.id, r.reg.id));
    await tx.insert(paymentEvents).values({ paymentAttemptId: attempt!.id, registrationId: r.reg.id, provider: provider.name, type: 'checkout.created', verified: false, fromStatus: r.reg.paymentStatus, toStatus: 'pending_external', actorUserId: ctx.user.id });
    return { checkoutUrl: session.checkoutUrl, provider: provider.label };
  });
}

const EVENT_STATUS: Record<string, PaymentStatus> = {
  'payment.succeeded': 'paid_verified',
  'payment.failed': 'failed',
  'payment.refunded': 'refunded',
  'payment.disputed': 'disputed',
};

/** Process a provider webhook. Idempotent by (provider, providerEventId). */
export async function handleWebhook(provider: PaymentProviderAdapter, rawBody: string, headers: Record<string, string | string[] | undefined>) {
  const event = provider.verifyWebhook(rawBody, headers);
  if (!event) throw new ApiError('FORBIDDEN', 'Invalid signature.');
  return db.transaction(async (tx) => {
    const [attempt] = await tx.select().from(paymentAttempts).where(and(eq(paymentAttempts.provider, provider.name), eq(paymentAttempts.providerReference, event.providerReference))).for('update');
    if (!attempt) throw notFound('Payment');
    const [reg] = await tx.select().from(registrations).where(eq(registrations.id, attempt.registrationId)).for('update');
    const to = EVENT_STATUS[event.type];
    if (!reg || !to) throw new ApiError('VALIDATION_FAILED', 'Unsupported event.');
    try {
      await tx.insert(paymentEvents).values({ paymentAttemptId: attempt.id, registrationId: reg.id, provider: provider.name, providerEventId: event.providerEventId, type: event.type, verified: true, fromStatus: reg.paymentStatus, toStatus: to });
    } catch (e) {
      if (uniqueViolation(e)) return { duplicate: true };
      throw e;
    }
    await tx.update(paymentAttempts).set({ status: to, updatedAt: new Date() }).where(eq(paymentAttempts.id, attempt.id));
    await tx.update(registrations).set({ paymentStatus: to, version: reg.version + 1, updatedAt: new Date() }).where(eq(registrations.id, reg.id));
    return { duplicate: false };
  });
}
