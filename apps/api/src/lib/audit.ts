import type { DbOrTx } from '../db/client';
import { auditEvents } from '../db/schema';
import type { RequestContext } from './context';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  tournamentId?: string | null;
  reason?: string | null;
  summary?: string | null;
  data?: unknown;
}

/** Append-only audit trail for staff and sensitive actions (spec §6, §16). */
export async function audit(tx: DbOrTx, ctx: RequestContext | null, e: AuditInput) {
  await tx.insert(auditEvents).values({
    actorUserId: ctx?.user?.id ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    tournamentId: e.tournamentId ?? null,
    reason: e.reason ?? null,
    summary: e.summary ?? null,
    data: e.data ?? null,
    ipAddress: ctx?.ip ?? null,
  });
}
