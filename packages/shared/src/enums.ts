// Canonical status vocabularies shared by API, database and UI.
// Changing these requires a migration (they back Postgres enums).

export const TOURNAMENT_STATUSES = [
  'draft',
  'published_open',
  'registration_closed',
  'in_progress',
  'completed',
  'canceled',
] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

/** Allowed lifecycle transitions. Reversals are permitted but always audited. */
export const TOURNAMENT_TRANSITIONS: Record<TournamentStatus, readonly TournamentStatus[]> = {
  draft: ['published_open', 'canceled'],
  published_open: ['registration_closed', 'in_progress', 'canceled', 'draft'],
  registration_closed: ['published_open', 'in_progress', 'canceled'],
  in_progress: ['completed', 'registration_closed', 'canceled'],
  completed: ['in_progress'],
  canceled: ['draft'],
};

export const PUBLIC_TOURNAMENT_STATUSES: readonly TournamentStatus[] = [
  'published_open',
  'registration_closed',
  'in_progress',
  'completed',
  'canceled',
];

export const REGISTRATION_STATUSES = [
  'draft',
  'submitted',
  'pending_review',
  'confirmed',
  'waitlisted',
  'rejected',
  'withdrawn',
  'canceled',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** A team may hold at most one registration in these states per division. */
export const ACTIVE_REGISTRATION_STATUSES: readonly RegistrationStatus[] = [
  'draft',
  'submitted',
  'pending_review',
  'confirmed',
  'waitlisted',
];

/**
 * Statuses that occupy a capacity slot. Assumption (DECISIONS.md): a registration under
 * review holds its spot so review mode can never oversubscribe a division.
 */
export const CAPACITY_HOLDING_STATUSES: readonly RegistrationStatus[] = ['pending_review', 'confirmed'];

export const REGISTRATION_TRANSITIONS: Record<RegistrationStatus, readonly RegistrationStatus[]> = {
  draft: ['submitted', 'canceled'],
  submitted: ['pending_review', 'confirmed', 'waitlisted', 'rejected'],
  pending_review: ['confirmed', 'waitlisted', 'rejected', 'withdrawn', 'canceled'],
  confirmed: ['withdrawn', 'canceled', 'pending_review'],
  waitlisted: ['confirmed', 'pending_review', 'rejected', 'withdrawn', 'canceled'],
  rejected: ['pending_review'],
  withdrawn: [],
  canceled: [],
};

export const PAYMENT_STATUSES = [
  'not_required',
  'not_started',
  'pending_external',
  'paid_verified',
  'failed',
  'refunded',
  'disputed',
  'manually_verified',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const REVIEW_MODES = ['auto_confirm', 'manual_review'] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export const GAME_STATUSES = [
  'scheduled',
  'delayed',
  'in_progress',
  'suspended',
  'postponed',
  'canceled',
  'final',
] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const GAME_RESULT_TYPES = ['played', 'forfeit'] as const;
export type GameResultType = (typeof GAME_RESULT_TYPES)[number];

export const GAME_STAGES = ['pool', 'bracket', 'other'] as const;
export type GameStage = (typeof GAME_STAGES)[number];

export const STAFF_ROLES = ['super_admin', 'tournament_director', 'scorekeeper', 'content_editor'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ANNOUNCEMENT_SEVERITIES = ['info', 'advisory', 'critical'] as const;
export type AnnouncementSeverity = (typeof ANNOUNCEMENT_SEVERITIES)[number];

export const ANNOUNCEMENT_CATEGORIES = [
  'general',
  'weather_delay',
  'field_closure',
  'schedule_change',
  'cancellation',
] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

export const ANNOUNCEMENT_STATUSES = ['draft', 'published', 'all_clear', 'superseded', 'withdrawn'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_SCOPES = ['organization', 'tournament', 'division', 'venue', 'field', 'game'] as const;
export type AnnouncementScope = (typeof ANNOUNCEMENT_SCOPES)[number];

export const BRACKET_STATUSES = ['draft', 'published'] as const;
export type BracketStatus = (typeof BRACKET_STATUSES)[number];

export const CONTENT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** Human labels; UI must always show text alongside any colour (spec §4). */
export const STATUS_LABELS = {
  tournament: {
    draft: 'Draft',
    published_open: 'Registration Open',
    registration_closed: 'Registration Closed',
    in_progress: 'In Progress',
    completed: 'Completed',
    canceled: 'Canceled',
  } satisfies Record<TournamentStatus, string>,
  registration: {
    draft: 'Draft',
    submitted: 'Submitted',
    pending_review: 'Pending Review',
    confirmed: 'Confirmed',
    waitlisted: 'Waitlisted',
    rejected: 'Not Accepted',
    withdrawn: 'Withdrawn',
    canceled: 'Canceled',
  } satisfies Record<RegistrationStatus, string>,
  payment: {
    not_required: 'No Payment Required',
    not_started: 'Payment Not Started',
    pending_external: 'Payment Pending',
    paid_verified: 'Paid (Verified)',
    failed: 'Payment Failed',
    refunded: 'Refunded',
    disputed: 'Disputed',
    manually_verified: 'Paid (Verified by Staff)',
  } satisfies Record<PaymentStatus, string>,
  game: {
    scheduled: 'Scheduled',
    delayed: 'Delayed',
    in_progress: 'In Progress',
    suspended: 'Suspended',
    postponed: 'Postponed',
    canceled: 'Canceled',
    final: 'Final',
  } satisfies Record<GameStatus, string>,
} as const;
