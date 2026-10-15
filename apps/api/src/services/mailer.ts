// Email outbox (ADR-012). Every message is persisted before sending so failures are visible
// and retried; the public site never depends on the mail vendor being up.
import { and, eq, lte, sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { config, isProd } from '../config';
import { db } from '../db/client';
import { notificationDeliveries } from '../db/schema';
import { logger } from '../lib/logger';

export interface MailAdapter {
  name: string;
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

/** Development only: the outbox row itself is the mailbox (read via /api/dev/mailbox). */
const devMailbox: MailAdapter = { name: 'dev-mailbox', send: async () => {} };

function smtpAdapter(): MailAdapter {
  if (!config.SMTP_URL) throw new Error('MAIL_DRIVER=smtp requires SMTP_URL');
  const transport = nodemailer.createTransport(config.SMTP_URL, { disableFileAccess: true, disableUrlAccess: true });
  return {
    name: 'smtp',
    send: async (m) => {
      await transport.sendMail({ from: config.MAIL_FROM, to: m.to, subject: m.subject, text: m.text });
    },
  };
}

let adapter: MailAdapter = config.MAIL_DRIVER === 'smtp' ? smtpAdapter() : devMailbox;
if (isProd && adapter.name === 'dev-mailbox') throw new Error('dev-mailbox cannot be used in production');

/** Test hook: swap the adapter (e.g. to simulate an outage). */
export function setMailAdapter(a: MailAdapter) {
  adapter = a;
}
export const getMailAdapter = () => adapter;

export class EmailDeliveryError extends Error {
  constructor(public deliveryId: string) {
    super('Email could not be delivered right now. It has been queued for retry.');
  }
}

export interface EnqueueInput {
  to: string;
  userId?: string | null;
  template: string;
  idempotencyKey: string;
  subject: string;
  text: string;
  /** Attempt delivery inline and throw EmailDeliveryError on failure (still retried later). */
  sendNow?: boolean;
}

export async function enqueueEmail(input: EnqueueInput): Promise<string | null> {
  const [row] = await db
    .insert(notificationDeliveries)
    .values({
      toAddress: input.to,
      userId: input.userId ?? null,
      template: input.template,
      idempotencyKey: input.idempotencyKey,
      subject: input.subject,
      textBody: input.text,
    })
    .onConflictDoNothing({ target: notificationDeliveries.idempotencyKey })
    .returning({ id: notificationDeliveries.id });
  if (!row) return null; // duplicate logical event: already queued/sent
  if (input.sendNow) {
    const ok = await attemptDelivery(row.id);
    if (!ok) throw new EmailDeliveryError(row.id);
  }
  return row.id;
}

const MAX_ATTEMPTS = 6;
const backoffSeconds = (attempt: number) => Math.min(3600, 30 * 2 ** (attempt - 1));

async function attemptDelivery(id: string): Promise<boolean> {
  const claimed = await db
    .update(notificationDeliveries)
    .set({ status: 'sending', attempts: sql`${notificationDeliveries.attempts} + 1` })
    .where(and(eq(notificationDeliveries.id, id), sql`${notificationDeliveries.status} in ('queued','failed')`))
    .returning();
  const d = claimed[0];
  if (!d) return true; // someone else is handling it
  try {
    await adapter.send({ to: d.toAddress, subject: d.subject, text: d.textBody });
    await db.update(notificationDeliveries).set({ status: 'sent', sentAt: new Date(), lastError: null }).where(eq(notificationDeliveries.id, id));
    return true;
  } catch (err) {
    const dead = d.attempts >= MAX_ATTEMPTS;
    await db
      .update(notificationDeliveries)
      .set({
        status: dead ? 'dead' : 'failed',
        lastError: String((err as Error).message ?? err).slice(0, 500),
        nextAttemptAt: new Date(Date.now() + backoffSeconds(d.attempts) * 1000),
      })
      .where(eq(notificationDeliveries.id, id));
    // Log ids only: never recipient addresses (may belong to families).
    logger.warn({ deliveryId: id, attempts: d.attempts, dead, template: d.template }, 'email delivery failed');
    return false;
  }
}

/** Process due deliveries. Safe to run concurrently across instances. */
export async function processOutbox(limit = 20): Promise<number> {
  const due = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(and(sql`${notificationDeliveries.status} in ('queued','failed')`, lte(notificationDeliveries.nextAttemptAt, new Date())))
    .limit(limit);
  let sent = 0;
  for (const d of due) if (await attemptDelivery(d.id)) sent++;
  return sent;
}

export function startOutboxWorker(intervalMs = 5_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await processOutbox();
    } catch (err) {
      logger.error({ err }, 'outbox worker error');
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
