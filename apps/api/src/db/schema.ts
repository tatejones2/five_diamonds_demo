// Domain schema (spec §14). Auth tables live in auth-schema.ts (better-auth managed).
// Conventions: uuid PKs, timestamptz in UTC, `version` columns for optimistic concurrency.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_SCOPES,
  ANNOUNCEMENT_SEVERITIES,
  ANNOUNCEMENT_STATUSES,
  BRACKET_STATUSES,
  CONTENT_STATUSES,
  GAME_RESULT_TYPES,
  GAME_STAGES,
  GAME_STATUSES,
  PAYMENT_STATUSES,
  REGISTRATION_STATUSES,
  REVIEW_MODES,
  STAFF_ROLES,
  TOURNAMENT_STATUSES,
  type Tiebreaker,
} from '@fd/shared';
import { user } from './auth-schema';

export * from './auth-schema';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();
const versionCol = () => integer('version').notNull().default(0);
const userRef = (name: string) => uuid(name).references(() => user.id, { onDelete: 'set null' });

// ---- Enums ------------------------------------------------------------------------------

export const tournamentStatus = pgEnum('tournament_status', TOURNAMENT_STATUSES);
export const registrationStatus = pgEnum('registration_status', REGISTRATION_STATUSES);
export const paymentStatus = pgEnum('payment_status', PAYMENT_STATUSES);
export const reviewMode = pgEnum('review_mode', REVIEW_MODES);
export const gameStatus = pgEnum('game_status', GAME_STATUSES);
export const gameResultType = pgEnum('game_result_type', GAME_RESULT_TYPES);
export const gameStage = pgEnum('game_stage', GAME_STAGES);
export const staffRole = pgEnum('staff_role', STAFF_ROLES);
export const announcementSeverity = pgEnum('announcement_severity', ANNOUNCEMENT_SEVERITIES);
export const announcementCategory = pgEnum('announcement_category', ANNOUNCEMENT_CATEGORIES);
export const announcementStatus = pgEnum('announcement_status', ANNOUNCEMENT_STATUSES);
export const announcementScope = pgEnum('announcement_scope', ANNOUNCEMENT_SCOPES);
export const bracketStatus = pgEnum('bracket_status', BRACKET_STATUSES);
export const contentStatus = pgEnum('content_status', CONTENT_STATUSES);
export const slotPosition = pgEnum('slot_position', ['top', 'bottom']);
export const deliveryStatus = pgEnum('delivery_status', ['queued', 'sending', 'sent', 'failed', 'dead']);

// ---- Organization & access --------------------------------------------------------------

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: createdAt(),
});

export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: staffRole('role').notNull(),
    /** Null = organization-wide. */
    tournamentId: uuid('tournament_id').references(() => tournaments.id, { onDelete: 'cascade' }),
    grantedBy: userRef('granted_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('role_assignments_unique').on(t.userId, t.role, sql`coalesce(${t.tournamentId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
    index('role_assignments_user_idx').on(t.userId),
  ],
);

export const gameAssignments = pgTable(
  'game_assignments',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    assignedBy: userRef('assigned_by'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.gameId] })],
);

// ---- Venues -----------------------------------------------------------------------------

export const venues = pgTable('venues', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  addressLine1: text('address_line1'),
  city: text('city'),
  state: text('state'),
  postalCode: text('postal_code'),
  directions: text('directions'),
  parking: text('parking'),
  policies: text('policies'),
  mapUrl: text('map_url'),
  isPublished: boolean('is_published').notNull().default(false),
  isDemo: boolean('is_demo').notNull().default(false),
  version: versionCol(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const fields = pgTable(
  'fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    hasLights: boolean('has_lights').notNull().default(false),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('fields_venue_name_unique').on(t.venueId, t.name)],
);

// ---- Tournaments ------------------------------------------------------------------------

export const tournaments = pgTable(
  'tournaments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    status: tournamentStatus('status').notNull().default('draft'),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    region: text('region'),
    category: text('category'),
    summary: text('summary'),
    description: text('description'),
    registrationOpensAt: ts('registration_opens_at'),
    registrationClosesAt: ts('registration_closes_at'),
    rosterLocksAt: ts('roster_locks_at'),
    feeInfo: text('fee_info'),
    refundPolicyUrl: text('refund_policy_url'),
    rulesText: text('rules_text'),
    operationalContacts: text('operational_contacts'),
    reviewMode: reviewMode('review_mode').notNull().default('manual_review'),
    waitlistEnabled: boolean('waitlist_enabled').notNull().default(true),
    paymentRequired: boolean('payment_required').notNull().default(false),
    /** Owner decision pending (DECISIONS.md): show registered team names publicly. Rosters are never public. */
    publicTeamNames: boolean('public_team_names').notNull().default(true),
    /** Schedule validation preferences (warnings). */
    fieldBufferMinutes: integer('field_buffer_minutes').notNull().default(0),
    minTeamRestMinutes: integer('min_team_rest_minutes').notNull().default(0),
    isDemo: boolean('is_demo').notNull().default(false),
    publishedAt: ts('published_at'),
    schedulePublishedAt: ts('schedule_published_at'),
    createdBy: userRef('created_by'),
    version: versionCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tournaments_status_dates_idx').on(t.status, t.startsOn),
    check('tournaments_dates_ck', sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

export const tournamentVenues = pgTable(
  'tournament_venues',
  {
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.venueId] })],
);

export const divisions = pgTable(
  'divisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ageLabel: text('age_label').notNull(),
    classification: text('classification'),
    capacity: integer('capacity').notNull(),
    rosterMin: integer('roster_min'),
    rosterMax: integer('roster_max'),
    allowDuplicateJersey: boolean('allow_duplicate_jersey').notNull().default(false),
    rulesText: text('rules_text'),
    gameFormat: text('game_format'),
    defaultGameMinutes: integer('default_game_minutes').notNull().default(90),
    tiesAllowedInPool: boolean('ties_allowed_in_pool').notNull().default(true),
    tiebreakers: jsonb('tiebreakers').$type<Tiebreaker[]>().notNull().default([]),
    runDifferentialCap: integer('run_differential_cap'),
    standingsSignedOff: boolean('standings_signed_off').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    version: versionCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('divisions_tournament_name_unique').on(t.tournamentId, t.name),
    check('divisions_capacity_ck', sql`${t.capacity} > 0`),
  ],
);

// ---- Teams & rosters --------------------------------------------------------------------

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    organizationName: text('organization_name'),
    ageGroup: text('age_group').notNull(),
    city: text('city'),
    state: text('state'),
    // Private contact details: never part of a public projection.
    coachContactName: text('coach_contact_name'),
    coachContactPhone: text('coach_contact_phone'),
    coachContactEmail: text('coach_contact_email'),
    rosterVersion: integer('roster_version').notNull().default(0),
    isDemo: boolean('is_demo').notNull().default(false),
    archivedAt: ts('archived_at'),
    version: versionCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('teams_owner_idx').on(t.ownerUserId)],
);

export const teamMemberships = pgTable(
  'team_memberships',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'coach'] }).notNull(),
    acceptedAt: ts('accepted_at'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const teamRosterEntries = pgTable(
  'team_roster_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    playerName: text('player_name').notNull(),
    jerseyNumber: text('jersey_number').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('roster_team_idx').on(t.teamId),
    check('roster_jersey_ck', sql`${t.jerseyNumber} ~ '^[0-9]{1,2}$'`),
  ],
);

// ---- Registrations ----------------------------------------------------------------------

export const registrations = pgTable(
  'registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    referenceCode: text('reference_code').notNull().unique(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'restrict' }),
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id, { onDelete: 'restrict' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    submittedBy: userRef('submitted_by'),
    status: registrationStatus('status').notNull(),
    paymentStatus: paymentStatus('payment_status').notNull().default('not_required'),
    waitlistedAt: ts('waitlisted_at'),
    staffNotes: text('staff_notes'),
    version: versionCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One active registration per (division, team); withdrawn/rejected/canceled may re-enter.
    uniqueIndex('registrations_active_unique')
      .on(t.divisionId, t.teamId)
      .where(sql`${t.status} in ('draft','submitted','pending_review','confirmed','waitlisted')`),
    index('registrations_tournament_idx').on(t.tournamentId, t.status),
    index('registrations_team_idx').on(t.teamId),
  ],
);

export const registrationStatusEvents = pgTable(
  'registration_status_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Monotonic order for events written in the same transaction (same created_at). */
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => registrations.id, { onDelete: 'cascade' }),
    fromStatus: registrationStatus('from_status'),
    toStatus: registrationStatus('to_status').notNull(),
    actorUserId: userRef('actor_user_id'),
    byStaff: boolean('by_staff').notNull().default(false),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [index('reg_events_reg_idx').on(t.registrationId)],
);

export const tournamentRosterSnapshots = pgTable(
  'tournament_roster_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => registrations.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    entries: jsonb('entries').$type<{ playerName: string; jerseyNumber: string }[]>().notNull(),
    createdBy: userRef('created_by'),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('roster_snapshot_rev_unique').on(t.registrationId, t.revision)],
);

export const paymentAttempts = pgTable('payment_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  registrationId: uuid('registration_id')
    .notNull()
    .references(() => registrations.id, { onDelete: 'restrict' }),
  provider: text('provider').notNull(),
  providerReference: text('provider_reference'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  amountCents: integer('amount_cents'),
  status: paymentStatus('status').notNull(),
  checkoutUrl: text('checkout_url'),
  createdBy: userRef('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const paymentEvents = pgTable('payment_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentAttemptId: uuid('payment_attempt_id').references(() => paymentAttempts.id, { onDelete: 'set null' }),
  registrationId: uuid('registration_id').references(() => registrations.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(),
  /** Provider event id; unique to make webhook processing idempotent. */
  providerEventId: text('provider_event_id'),
  type: text('type').notNull(),
  verified: boolean('verified').notNull().default(false),
  fromStatus: paymentStatus('from_status'),
  toStatus: paymentStatus('to_status'),
  actorUserId: userRef('actor_user_id'),
  reason: text('reason'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('payment_events_provider_event_unique').on(t.provider, t.providerEventId)]);

// ---- Schedule & games -------------------------------------------------------------------

export interface PublishedGameProjection {
  divisionId: string;
  stage: (typeof GAME_STAGES)[number];
  poolLabel: string | null;
  label: string | null;
  fieldId: string | null;
  startsAt: string | null;
  durationMinutes: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homePlaceholder: string | null;
  awayPlaceholder: string | null;
  status: (typeof GAME_STATUSES)[number];
  resultType: (typeof GAME_RESULT_TYPES)[number];
  homeScore: number | null;
  awayScore: number | null;
  forfeitWinner: 'home' | 'away' | null;
  bracketMatchupId: string | null;
}

export const scheduleVersions = pgTable(
  'schedule_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    publishedBy: userRef('published_by'),
    note: text('note'),
    changeSummary: jsonb('change_summary').$type<{ added: number; changed: number; removed: number }>().notNull(),
    warningsAcknowledged: jsonb('warnings_acknowledged').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('schedule_versions_unique').on(t.tournamentId, t.versionNumber)],
);

export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id, { onDelete: 'restrict' }),
    stage: gameStage('stage').notNull().default('pool'),
    poolLabel: text('pool_label'),
    label: text('label'),
    fieldId: uuid('field_id').references(() => fields.id, { onDelete: 'restrict' }),
    startsAt: ts('starts_at'),
    durationMinutes: integer('duration_minutes').notNull(),
    homeTeamId: uuid('home_team_id').references(() => teams.id, { onDelete: 'restrict' }),
    awayTeamId: uuid('away_team_id').references(() => teams.id, { onDelete: 'restrict' }),
    homePlaceholder: text('home_placeholder'),
    awayPlaceholder: text('away_placeholder'),
    status: gameStatus('status').notNull().default('scheduled'),
    resultType: gameResultType('result_type').notNull().default('played'),
    homeScore: integer('home_score'),
    awayScore: integer('away_score'),
    forfeitWinner: text('forfeit_winner', { enum: ['home', 'away'] }),
    bracketMatchupId: uuid('bracket_matchup_id').references((): AnyPgColumn => bracketMatchups.id, { onDelete: 'set null' }),
    /** Public projection as of the last publish/operational update; null = never published. */
    published: jsonb('published').$type<PublishedGameProjection>(),
    publishedAt: ts('published_at'),
    /** Soft delete for draft removal of a published game (removed on next publish). */
    deletedAt: ts('deleted_at'),
    finalizedAt: ts('finalized_at'),
    finalizedBy: userRef('finalized_by'),
    version: versionCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('games_tournament_idx').on(t.tournamentId),
    index('games_field_time_idx').on(t.fieldId, t.startsAt),
    uniqueIndex('games_bracket_matchup_unique').on(t.bracketMatchupId).where(sql`${t.deletedAt} is null`),
    check('games_scores_nonneg_ck', sql`(${t.homeScore} is null or ${t.homeScore} >= 0) and (${t.awayScore} is null or ${t.awayScore} >= 0)`),
    check(
      'games_final_complete_ck',
      sql`${t.status} <> 'final' or (${t.resultType} = 'forfeit' and ${t.forfeitWinner} is not null) or (${t.resultType} = 'played' and ${t.homeScore} is not null and ${t.awayScore} is not null)`,
    ),
    check('games_distinct_teams_ck', sql`${t.homeTeamId} is null or ${t.awayTeamId} is null or ${t.homeTeamId} <> ${t.awayTeamId}`),
    check('games_duration_ck', sql`${t.durationMinutes} between 15 and 360`),
  ],
);

export const gameVersions = pgTable(
  'game_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['draft_edit', 'schedule_publish', 'operational', 'result', 'correction', 'bracket_advance', 'bracket_reset'] }).notNull(),
    scheduleVersionId: uuid('schedule_version_id').references(() => scheduleVersions.id, { onDelete: 'set null' }),
    snapshot: jsonb('snapshot').$type<PublishedGameProjection>().notNull(),
    actorUserId: userRef('actor_user_id'),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [index('game_versions_game_idx').on(t.gameId, t.createdAt)],
);

// ---- Brackets ---------------------------------------------------------------------------

export const brackets = pgTable('brackets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  divisionId: uuid('division_id')
    .notNull()
    .references(() => divisions.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  format: text('format', { enum: ['single_elimination'] }).notNull().default('single_elimination'),
  size: integer('size').notNull(),
  entrants: integer('entrants').notNull(),
  status: bracketStatus('status').notNull().default('draft'),
  publishedAt: ts('published_at'),
  createdBy: userRef('created_by'),
  version: versionCol(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const bracketRounds = pgTable(
  'bracket_rounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bracketId: uuid('bracket_id')
      .notNull()
      .references(() => brackets.id, { onDelete: 'cascade' }),
    roundNumber: integer('round_number').notNull(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('bracket_rounds_unique').on(t.bracketId, t.roundNumber)],
);

export const bracketMatchups = pgTable(
  'bracket_matchups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bracketId: uuid('bracket_id')
      .notNull()
      .references(() => brackets.id, { onDelete: 'cascade' }),
    roundId: uuid('round_id')
      .notNull()
      .references(() => bracketRounds.id, { onDelete: 'cascade' }),
    roundNumber: integer('round_number').notNull(),
    position: integer('position').notNull(),
    key: text('key').notNull(),
    /** Winner as resolved from a final game, bye, or logged director override. */
    winnerSlot: slotPosition('winner_slot'),
  },
  (t) => [
    uniqueIndex('bracket_matchups_pos_unique').on(t.bracketId, t.roundNumber, t.position),
    uniqueIndex('bracket_matchups_key_unique').on(t.bracketId, t.key),
  ],
);

export const bracketSlots = pgTable(
  'bracket_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matchupId: uuid('matchup_id')
      .notNull()
      .references(() => bracketMatchups.id, { onDelete: 'cascade' }),
    position: slotPosition('position').notNull(),
    seed: integer('seed'),
    isBye: boolean('is_bye').notNull().default(false),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'restrict' }),
    filledBy: text('filled_by', { enum: ['seed', 'advancement', 'override'] }),
  },
  (t) => [
    uniqueIndex('bracket_slots_unique').on(t.matchupId, t.position),
    check('bracket_slots_bye_ck', sql`not (${t.isBye} and ${t.teamId} is not null)`),
  ],
);

export const bracketAdvancementEdges = pgTable(
  'bracket_advancement_edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bracketId: uuid('bracket_id')
      .notNull()
      .references(() => brackets.id, { onDelete: 'cascade' }),
    fromMatchupId: uuid('from_matchup_id')
      .notNull()
      .references(() => bracketMatchups.id, { onDelete: 'cascade' }),
    toMatchupId: uuid('to_matchup_id')
      .notNull()
      .references(() => bracketMatchups.id, { onDelete: 'cascade' }),
    toSlot: slotPosition('to_slot').notNull(),
  },
  (t) => [
    // Each winner advances to exactly one place, and each slot is fed by at most one matchup.
    uniqueIndex('bracket_edges_from_unique').on(t.fromMatchupId),
    uniqueIndex('bracket_edges_dest_unique').on(t.toMatchupId, t.toSlot),
    check('bracket_edges_no_self_ck', sql`${t.fromMatchupId} <> ${t.toMatchupId}`),
  ],
);

// ---- Announcements & notifications ------------------------------------------------------

export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tournamentId: uuid('tournament_id').references(() => tournaments.id, { onDelete: 'cascade' }),
    scope: announcementScope('scope').notNull(),
    scopeId: uuid('scope_id'),
    severity: announcementSeverity('severity').notNull(),
    category: announcementCategory('category').notNull(),
    status: announcementStatus('status').notNull().default('draft'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    source: text('source'),
    linkUrl: text('link_url'),
    effectiveAt: ts('effective_at'),
    expiresAt: ts('expires_at'),
    publishedAt: ts('published_at'),
    allClearAt: ts('all_clear_at'),
    allClearMessage: text('all_clear_message'),
    supersededById: uuid('superseded_by_id'),
    authorUserId: userRef('author_user_id'),
    version: versionCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('announcements_tournament_status_idx').on(t.tournamentId, t.status)],
);

export const announcementGames = pgTable(
  'announcement_games',
  {
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.announcementId, t.gameId] })],
);

export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  emailRegistrationUpdates: boolean('email_registration_updates').notNull().default(true),
  emailEventNotices: boolean('email_event_notices').notNull().default(false),
  updatedAt: updatedAt(),
});

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: text('channel', { enum: ['email'] }).notNull().default('email'),
    toAddress: text('to_address').notNull(),
    userId: userRef('user_id'),
    template: text('template').notNull(),
    subject: text('subject').notNull(),
    textBody: text('text_body').notNull(),
    /** Prevents duplicate sends for the same logical event. */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: deliveryStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    lastError: text('last_error'),
    sentAt: ts('sent_at'),
    createdAt: createdAt(),
  },
  (t) => [index('deliveries_due_idx').on(t.status, t.nextAttemptAt)],
);

// ---- Content ----------------------------------------------------------------------------

export const contentPages = pgTable('content_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  title: text('title').notNull(),
  draftBody: text('draft_body').notNull().default(''),
  publishedBody: text('published_body'),
  publishedTitle: text('published_title'),
  seoDescription: text('seo_description'),
  status: contentStatus('status').notNull().default('draft'),
  /** Legal/business copy must be owner-approved before it is shown as final (spec §5). */
  ownerApproved: boolean('owner_approved').notNull().default(false),
  publishedAt: ts('published_at'),
  version: versionCol(),
  updatedBy: userRef('updated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const contentRevisions = pgTable('content_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityType: text('entity_type', { enum: ['page', 'news'] }).notNull(),
  entityId: uuid('entity_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  action: text('action', { enum: ['save', 'publish', 'unpublish'] }).notNull(),
  actorUserId: userRef('actor_user_id'),
  createdAt: createdAt(),
}, (t) => [index('content_revisions_entity_idx').on(t.entityType, t.entityId)]);

export const newsPosts = pgTable('news_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  excerpt: text('excerpt'),
  draftBody: text('draft_body').notNull().default(''),
  publishedBody: text('published_body'),
  publishedTitle: text('published_title'),
  status: contentStatus('status').notNull().default('draft'),
  tournamentId: uuid('tournament_id').references(() => tournaments.id, { onDelete: 'set null' }),
  coverAssetId: uuid('cover_asset_id'),
  isDemo: boolean('is_demo').notNull().default(false),
  publishedAt: ts('published_at'),
  authorUserId: userRef('author_user_id'),
  version: versionCol(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  storageKey: text('storage_key').notNull().unique(),
  visibility: text('visibility', { enum: ['public', 'private'] }).notNull(),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  altText: text('alt_text'),
  caption: text('caption'),
  credit: text('credit'),
  /** Use-rights metadata (spec §12): who granted rights, and whether minors are identifiable. */
  rightsNote: text('rights_note'),
  rightsConfirmed: boolean('rights_confirmed').notNull().default(false),
  isPublished: boolean('is_published').notNull().default(false),
  uploadedBy: userRef('uploaded_by'),
  createdAt: createdAt(),
});

export const sponsors = pgTable('sponsors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  websiteUrl: text('website_url'),
  tier: text('tier'),
  logoAssetId: uuid('logo_asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
  isPublished: boolean('is_published').notNull().default(false),
  ownerApproved: boolean('owner_approved').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const staffProfiles = pgTable('staff_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  title: text('title').notNull(),
  bio: text('bio'),
  photoAssetId: uuid('photo_asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
  publicEmail: text('public_email'),
  publicPhone: text('public_phone'),
  contactPublishingApproved: boolean('contact_publishing_approved').notNull().default(false),
  isPublished: boolean('is_published').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const faqs = pgTable('faqs', {
  id: uuid('id').primaryKey().defaultRandom(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  isPublished: boolean('is_published').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const contactSubmissions = pgTable('contact_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  topic: text('topic').notNull(),
  message: text('message').notNull(),
  status: text('status', { enum: ['new', 'in_progress', 'closed', 'spam'] }).notNull().default('new'),
  handledBy: userRef('handled_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---- Audit ------------------------------------------------------------------------------

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: userRef('actor_user_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    tournamentId: uuid('tournament_id'),
    reason: text('reason'),
    summary: text('summary'),
    /** Structured before/after diff. Stays in the database; never written to logs. */
    data: jsonb('data'),
    ipAddress: text('ip_address'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_tournament_idx').on(t.tournamentId, t.createdAt),
    index('audit_entity_idx').on(t.entityType, t.entityId),
    index('audit_created_idx').on(t.createdAt),
  ],
);
