// Payment boundary (spec §7, ADR-013). Provider is not chosen; only a SIMULATED adapter exists.
// A browser return URL is never treated as proof of payment — only a verified callback is.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config, isProd } from '../config';

export interface CheckoutSession {
  providerReference: string;
  checkoutUrl: string;
}

export interface VerifiedPaymentEvent {
  providerEventId: string;
  providerReference: string;
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded' | 'payment.disputed';
}

export interface PaymentProviderAdapter {
  readonly name: string;
  /** Human label shown to staff; must make simulated providers unmistakable. */
  readonly label: string;
  createCheckout(input: { registrationId: string; referenceCode: string; amountCents: number | null; idempotencyKey: string; returnUrl: string }): Promise<CheckoutSession>;
  /** Verify a server-to-server callback. Returns null if the signature is invalid. */
  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): VerifiedPaymentEvent | null;
}

const simulatedKey = () => createHmac('sha256', config.AUTH_SECRET).update('simulated-payments').digest();

export function signSimulatedPayload(rawBody: string) {
  return createHmac('sha256', simulatedKey()).update(rawBody).digest('hex');
}

export const simulatedProvider: PaymentProviderAdapter = {
  name: 'simulated',
  label: 'SIMULATED — no real money moves',
  async createCheckout(input) {
    const providerReference = `sim_${randomUUID()}`;
    const url = new URL('/dev/simulated-checkout', config.APP_ORIGIN);
    url.searchParams.set('ref', providerReference);
    url.searchParams.set('code', input.referenceCode);
    return { providerReference, checkoutUrl: url.toString() };
  },
  verifyWebhook(rawBody, headers) {
    const sig = headers['x-simulated-signature'];
    if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return null;
    const expected = Buffer.from(signSimulatedPayload(rawBody), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(sig, 'hex'))) return null;
    try {
      const body = JSON.parse(rawBody) as VerifiedPaymentEvent;
      if (!body.providerEventId || !body.providerReference || !body.type) return null;
      return body;
    } catch {
      return null;
    }
  },
};

export function getPaymentProvider(): PaymentProviderAdapter | null {
  if (config.PAYMENT_PROVIDER === 'disabled') return null;
  if (isProd) throw new Error('Simulated payments are not allowed in production.');
  return simulatedProvider;
}
