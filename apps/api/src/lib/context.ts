import type { StaffRole } from '@fd/shared';
import { fromNodeHeaders } from 'better-auth/node';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { auth } from '../auth';
import { config } from '../config';
import { db } from '../db/client';
import { roleAssignments } from '../db/schema';
import { ApiError } from './errors';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

export interface RequestContext {
  user: SessionUser | null;
  roles: { role: StaffRole; tournamentId: string | null }[];
  ip: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    _ctx?: Promise<RequestContext>;
  }
}

export function getContext(req: FastifyRequest): Promise<RequestContext> {
  req._ctx ??= (async () => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) return { user: null, roles: [], ip: req.ip };
    const u = session.user as typeof session.user & { twoFactorEnabled?: boolean | null };
    const roles = await db
      .select({ role: roleAssignments.role, tournamentId: roleAssignments.tournamentId })
      .from(roleAssignments)
      .where(eq(roleAssignments.userId, u.id));
    return {
      user: { id: u.id, name: u.name, email: u.email, emailVerified: u.emailVerified, twoFactorEnabled: !!u.twoFactorEnabled },
      roles,
      ip: req.ip,
    };
  })();
  return req._ctx;
}

export type AuthedContext = RequestContext & { user: SessionUser };

/** Any signed-in, email-verified adult account (the implicit "manager" role). */
export async function requireUser(req: FastifyRequest): Promise<AuthedContext> {
  const ctx = await getContext(req);
  if (!ctx.user) throw new ApiError('UNAUTHENTICATED', 'Please sign in.');
  if (!ctx.user.emailVerified) throw new ApiError('EMAIL_NOT_VERIFIED', 'Verify your email address to continue.');
  return ctx as AuthedContext;
}

export const isStaff = (ctx: RequestContext) => ctx.roles.length > 0;

/** Any staff role, with MFA enforced when configured (spec §13: MFA for high-privilege staff). */
export async function requireStaff(req: FastifyRequest): Promise<AuthedContext> {
  const ctx = await requireUser(req);
  if (!isStaff(ctx)) throw new ApiError('FORBIDDEN', 'Staff access required.');
  if (config.STAFF_MFA_REQUIRED && !ctx.user.twoFactorEnabled) {
    throw new ApiError('FORBIDDEN', 'Staff accounts must enable two-factor authentication.', { reason: 'mfa_required' });
  }
  return ctx;
}
