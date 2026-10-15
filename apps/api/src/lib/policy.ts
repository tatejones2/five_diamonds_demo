// Authorization policies (spec §6). Deny by default; every check runs server-side.
// Each function answers one question so handlers read as plain sentences.
import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { gameAssignments, registrations, teams } from '../db/schema';
import type { AuthedContext, RequestContext } from './context';
import { ApiError, notFound } from './errors';

const has = (ctx: RequestContext, role: string, tournamentId?: string | null) =>
  ctx.roles.some((r) => r.role === role && (r.tournamentId === null || (tournamentId != null && r.tournamentId === tournamentId)));

export const isSuperAdmin = (ctx: RequestContext) => ctx.roles.some((r) => r.role === 'super_admin' && r.tournamentId === null);

/** Directors are scoped to assigned tournaments; org-wide directors have tournamentId = null. */
export const canManageTournament = (ctx: RequestContext, tournamentId: string) =>
  isSuperAdmin(ctx) || has(ctx, 'tournament_director', tournamentId);

/** Creating new tournaments requires an org-wide director or super admin. */
export const canCreateTournament = (ctx: RequestContext) =>
  isSuperAdmin(ctx) || ctx.roles.some((r) => r.role === 'tournament_director' && r.tournamentId === null);

/** Tournament ids this user may manage, or 'all'. */
export function managedTournamentScope(ctx: RequestContext): 'all' | string[] {
  if (isSuperAdmin(ctx) || ctx.roles.some((r) => r.role === 'tournament_director' && r.tournamentId === null)) return 'all';
  return ctx.roles.filter((r) => r.role === 'tournament_director' && r.tournamentId).map((r) => r.tournamentId!);
}

export const canEditContent = (ctx: RequestContext) => isSuperAdmin(ctx) || has(ctx, 'content_editor');
export const canEditNews = (ctx: RequestContext) => canEditContent(ctx);
export const canManageStaff = (ctx: RequestContext) => isSuperAdmin(ctx);
export const canManageVenues = (ctx: RequestContext) => canCreateTournament(ctx);

export async function canScoreGame(tx: DbOrTx, ctx: RequestContext, game: { id: string; tournamentId: string }) {
  if (canManageTournament(ctx, game.tournamentId)) return true;
  if (!ctx.user || !has(ctx, 'scorekeeper', game.tournamentId)) return false;
  const [a] = await tx
    .select({ gameId: gameAssignments.gameId })
    .from(gameAssignments)
    .where(and(eq(gameAssignments.userId, ctx.user.id), eq(gameAssignments.gameId, game.id)))
    .limit(1);
  return !!a;
}

export function assert(allowed: boolean, message?: string): asserts allowed {
  if (!allowed) throw new ApiError('FORBIDDEN', message ?? 'You do not have permission to do that.');
}

/**
 * Load a team the caller owns. Returns NOT_FOUND (not FORBIDDEN) for other users' teams so
 * responses never reveal whether a private team exists (spec §15).
 */
export async function loadOwnTeam(tx: DbOrTx, ctx: AuthedContext, teamId: string, opts: { forUpdate?: boolean } = {}) {
  const q = tx.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.ownerUserId, ctx.user.id)));
  const [team] = opts.forUpdate ? await q.for('update') : await q;
  if (!team || team.archivedAt) throw notFound('Team');
  return team;
}

/**
 * Staff read of a private team: allowed for super admins, or directors of a tournament the team
 * has registered for (scoped read*, spec §6).
 */
export async function staffCanReadTeam(tx: DbOrTx, ctx: RequestContext, teamId: string) {
  if (isSuperAdmin(ctx)) return true;
  const scope = managedTournamentScope(ctx);
  const regs = await tx.select({ t: registrations.tournamentId }).from(registrations).where(eq(registrations.teamId, teamId));
  if (scope === 'all') return regs.length > 0 || ctx.roles.some((r) => r.role === 'tournament_director' && r.tournamentId === null);
  return regs.some((r) => scope.includes(r.t));
}
