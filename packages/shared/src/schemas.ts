// Runtime-validated API request contracts (spec §13). Responses are typed in api-types.ts.
import { z } from 'zod';
import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_SCOPES,
  ANNOUNCEMENT_SEVERITIES,
  GAME_RESULT_TYPES,
  GAME_STAGES,
  GAME_STATUSES,
  PAYMENT_STATUSES,
  REGISTRATION_STATUSES,
  REVIEW_MODES,
  STAFF_ROLES,
  TOURNAMENT_STATUSES,
} from './enums';
import { TIEBREAKERS } from './results';

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'EMAIL_NOT_VERIFIED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'CAPACITY_FULL',
  'DUPLICATE_REGISTRATION',
  'REGISTRATION_CLOSED',
  'ROSTER_LOCKED',
  'INVALID_TRANSITION',
  'SCHEDULE_INVALID',
  'DOWNSTREAM_CONFLICT',
  'RATE_LIMITED',
  'FILE_REJECTED',
  'EMAIL_DELIVERY_FAILED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

const trimmed = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(1, 'Required').max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const wallTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour)');
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only')
  .max(80);
const uuid = z.uuid();
const version = z.number().int().nonnegative();
const urlOrNull = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .nullish()
  .transform((v) => v ?? null);

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---- Tournaments ------------------------------------------------------------------------

export const tournamentListQuery = paginationQuery.extend({
  when: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: trimmed(100).optional(),
  ageLabel: trimmed(20).optional(),
  venue: slug.optional(),
  availability: z.enum(['open', 'full', 'any']).default('any'),
});

export const tournamentInput = z
  .object({
    title: required(120),
    slug,
    startsOn: isoDate,
    endsOn: isoDate,
    region: optionalText(120),
    category: optionalText(80),
    summary: optionalText(300),
    description: optionalText(20_000),
    registrationOpensAt: z.iso.datetime({ offset: true }).nullish().transform((v) => v ?? null),
    registrationClosesAt: z.iso.datetime({ offset: true }).nullish().transform((v) => v ?? null),
    rosterLocksAt: z.iso.datetime({ offset: true }).nullish().transform((v) => v ?? null),
    feeInfo: optionalText(500),
    refundPolicyUrl: urlOrNull,
    rulesText: optionalText(20_000),
    operationalContacts: optionalText(1_000),
    reviewMode: z.enum(REVIEW_MODES).default('manual_review'),
    waitlistEnabled: z.boolean().default(true),
    paymentRequired: z.boolean().default(false),
    publicTeamNames: z.boolean().default(true),
    fieldBufferMinutes: z.number().int().min(0).max(120).default(0),
    minTeamRestMinutes: z.number().int().min(0).max(600).default(0),
    venueIds: z.array(uuid).max(20).default([]),
  })
  .refine((t) => t.endsOn >= t.startsOn, { path: ['endsOn'], message: 'End date must be on or after the start date.' })
  .refine((t) => !t.registrationOpensAt || !t.registrationClosesAt || t.registrationClosesAt > t.registrationOpensAt, {
    path: ['registrationClosesAt'],
    message: 'Registration must close after it opens.',
  });
export type TournamentInput = z.infer<typeof tournamentInput>;

export const tournamentUpdate = z.object({ version, data: tournamentInput });

export const tournamentTransition = z.object({
  version,
  to: z.enum(TOURNAMENT_STATUSES),
  reason: optionalText(500),
});

export const divisionInput = z.object({
  name: required(80),
  ageLabel: required(20),
  classification: optionalText(40),
  capacity: z.number().int().min(1).max(256),
  rosterMin: z.number().int().min(0).max(60).nullable().default(null),
  rosterMax: z.number().int().min(1).max(60).nullable().default(null),
  allowDuplicateJersey: z.boolean().default(false),
  rulesText: optionalText(10_000),
  gameFormat: optionalText(500),
  defaultGameMinutes: z.number().int().min(15).max(360).default(90),
  tiesAllowedInPool: z.boolean().default(true),
  tiebreakers: z.array(z.enum(TIEBREAKERS)).max(TIEBREAKERS.length).default([]),
  runDifferentialCap: z.number().int().min(1).max(50).nullable().default(null),
  standingsSignedOff: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type DivisionInput = z.infer<typeof divisionInput>;
export const divisionUpdate = z.object({ version, data: divisionInput });

// ---- Venues -----------------------------------------------------------------------------

export const venueInput = z.object({
  name: required(120),
  slug,
  addressLine1: optionalText(200),
  city: optionalText(80),
  state: optionalText(2),
  postalCode: optionalText(10),
  directions: optionalText(5_000),
  parking: optionalText(5_000),
  policies: optionalText(5_000),
  mapUrl: urlOrNull,
  isPublished: z.boolean().default(false),
});
export const fieldInput = z.object({
  name: required(60),
  hasLights: z.boolean().default(false),
  notes: optionalText(500),
  isActive: z.boolean().default(true),
});

// ---- Teams & rosters ----------------------------------------------------------------------

export const teamInput = z.object({
  name: required(80),
  organizationName: optionalText(120),
  ageGroup: required(20),
  city: optionalText(80),
  state: optionalText(2),
  coachContactName: optionalText(120),
  coachContactPhone: optionalText(30),
  coachContactEmail: z.email().max(200).nullish().transform((v) => v ?? null),
});
export type TeamInput = z.infer<typeof teamInput>;
export const teamUpdate = z.object({ version, data: teamInput });

export const rosterEntryInput = z.object({
  id: uuid.optional(),
  playerName: z.string().max(200),
  jerseyNumber: z.string().max(10),
});
export const rosterReplace = z.object({
  version,
  entries: z.array(rosterEntryInput).max(100),
  /** Staff edits must give a reason (spec §8). Managers may omit. */
  reason: optionalText(500),
});

// ---- Registrations --------------------------------------------------------------------------

export const registrationCreate = z.object({
  divisionId: uuid,
  teamId: uuid,
  joinWaitlistIfFull: z.boolean().default(false),
  acknowledgeRules: z.literal(true, { error: 'You must acknowledge the event rules.' }),
});

export const registrationStatusChange = z.object({
  version,
  to: z.enum(REGISTRATION_STATUSES),
  reason: required(500),
  /** Explicit admin override to exceed capacity. Logged. */
  overrideCapacity: z.boolean().default(false),
});

export const paymentStatusChange = z.object({
  version,
  to: z.enum(PAYMENT_STATUSES),
  reason: required(500),
  externalReference: optionalText(120),
});

// ---- Schedule -----------------------------------------------------------------------------

export const gameDraftInput = z.object({
  id: uuid.optional(),
  version: version.optional(),
  divisionId: uuid,
  stage: z.enum(GAME_STAGES).default('pool'),
  poolLabel: optionalText(20),
  label: optionalText(40),
  fieldId: uuid.nullable(),
  date: isoDate.nullable(),
  time: wallTime.nullable(),
  durationMinutes: z.number().int().min(15).max(360),
  homeTeamId: uuid.nullable(),
  awayTeamId: uuid.nullable(),
  homePlaceholder: optionalText(60),
  awayPlaceholder: optionalText(60),
});
export type GameDraftInput = z.infer<typeof gameDraftInput>;

export const scheduleConstraintsInput = z.object({
  fieldBufferMinutes: z.number().int().min(0).max(120).default(0),
  minTeamRestMinutes: z.number().int().min(0).max(600).default(0),
});

export const schedulePublish = z.object({
  /** Opaque hash of the draft the director previewed; publish fails if it changed since. */
  previewToken: z.string().min(8).max(128),
  note: optionalText(500),
  acknowledgeWarnings: z.boolean().default(false),
});

export const gameOperationalUpdate = z.object({
  version,
  status: z.enum(GAME_STATUSES),
  resultType: z.enum(GAME_RESULT_TYPES).default('played'),
  homeScore: z.number().int().min(0).max(99).nullable(),
  awayScore: z.number().int().min(0).max(99).nullable(),
  forfeitWinner: z.enum(['home', 'away']).nullable().default(null),
  /** Reschedule fields: changing these on a published game publishes immediately with a reason. */
  fieldId: uuid.nullable().optional(),
  date: isoDate.nullable().optional(),
  time: wallTime.nullable().optional(),
  reason: optionalText(500),
  /** Required when correcting a final whose bracket successors already have results. */
  downstreamResolution: z.enum(['reset_downstream', 'keep_downstream']).optional(),
});

// ---- Brackets -----------------------------------------------------------------------------

export const bracketCreate = z.object({
  divisionId: uuid,
  name: required(80),
  size: z.number().int(),
  entrants: z.number().int(),
});

export const bracketSeeding = z.object({
  version,
  seeds: z.array(z.object({ seed: z.number().int().min(1).max(64), teamId: uuid.nullable() })).max(64),
  reason: optionalText(500),
});

export const bracketGameLink = z.object({
  version,
  matchupId: uuid,
  fieldId: uuid.nullable(),
  date: isoDate.nullable(),
  time: wallTime.nullable(),
  durationMinutes: z.number().int().min(15).max(360),
});

export const bracketOverride = z.object({
  version,
  slotId: uuid,
  teamId: uuid.nullable(),
  reason: required(500),
});

// ---- Announcements --------------------------------------------------------------------------

export const announcementInput = z.object({
  tournamentId: uuid.nullable(),
  scope: z.enum(ANNOUNCEMENT_SCOPES),
  scopeId: uuid.nullable(),
  severity: z.enum(ANNOUNCEMENT_SEVERITIES),
  category: z.enum(ANNOUNCEMENT_CATEGORIES),
  title: required(120),
  body: required(4_000),
  effectiveAt: z.iso.datetime({ offset: true }).nullish().transform((v) => v ?? null),
  expiresAt: z.iso.datetime({ offset: true }).nullish().transform((v) => v ?? null),
  affectedGameIds: z.array(uuid).max(200).default([]),
  source: optionalText(120),
  linkUrl: urlOrNull,
});
export type AnnouncementInput = z.infer<typeof announcementInput>;

export const announcementAction = z.object({
  version,
  action: z.enum(['publish', 'all_clear', 'withdraw']),
  message: optionalText(1_000),
});

// ---- Staff ----------------------------------------------------------------------------------

export const roleAssignmentInput = z.object({
  email: z.email(),
  role: z.enum(STAFF_ROLES),
  tournamentId: uuid.nullable(),
});
export const gameAssignmentInput = z
  .object({ userId: z.uuid().optional(), email: z.email().optional(), gameIds: z.array(uuid).min(1).max(200) })
  .refine((v) => v.userId || v.email, { message: 'Choose a staff member.', path: ['email'] });

// ---- Content --------------------------------------------------------------------------------

export const contentPageInput = z.object({
  version,
  title: required(120),
  body: trimmed(50_000),
  seoDescription: optionalText(300),
});
export const newsPostInput = z.object({
  title: required(160),
  slug,
  excerpt: optionalText(400),
  body: trimmed(50_000),
  tournamentId: uuid.nullable().default(null),
});
export const sponsorInput = z.object({
  name: required(120),
  websiteUrl: urlOrNull,
  tier: optionalText(40),
  logoAssetId: uuid.nullable().default(null),
  isPublished: z.boolean().default(false),
  ownerApproved: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export const staffProfileInput = z.object({
  name: required(120),
  title: required(120),
  bio: optionalText(2_000),
  publicEmail: z.email().nullish().transform((v) => v ?? null),
  publicPhone: optionalText(30),
  contactPublishingApproved: z.boolean().default(false),
  isPublished: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export const faqInput = z.object({
  question: required(300),
  answer: required(5_000),
  isPublished: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

export const contactSubmissionInput = z.object({
  name: required(120),
  email: z.email().max(200),
  phone: optionalText(30),
  topic: z.enum(['general', 'registration', 'sponsorship', 'get_involved', 'media', 'other']),
  message: required(5_000),
  /** Honeypot. Accepted by validation so bots get no signal; the server silently drops non-empty values. */
  website: z.string().max(500).optional().default(''),
});

export const notificationPreferencesInput = z.object({
  emailRegistrationUpdates: z.boolean(),
  emailEventNotices: z.boolean(),
});
