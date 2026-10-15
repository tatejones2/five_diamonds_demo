// Response DTOs. Public types are deliberately narrow "safe projections" (spec §14):
// they never contain player names, contact details or payment data.
import type {
  AnnouncementCategory,
  AnnouncementScope,
  AnnouncementSeverity,
  AnnouncementStatus,
  GameResultType,
  GameStage,
  GameStatus,
  PaymentStatus,
  RegistrationStatus,
  ReviewMode,
  StaffRole,
  TournamentStatus,
} from './enums';
import type { Tiebreaker } from './results';

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PublicVenueRef {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  state: string | null;
}

export interface PublicDivision {
  id: string;
  name: string;
  ageLabel: string;
  classification: string | null;
  capacity: number;
  /** Null when the count shouldn't be shown (e.g. registration not open). */
  spotsRemaining: number | null;
  isFull: boolean;
  waitlistAvailable: boolean;
  gameFormat: string | null;
  rulesText: string | null;
}

export interface PublicTournamentSummary {
  id: string;
  slug: string;
  title: string;
  status: TournamentStatus;
  startsOn: string;
  endsOn: string;
  region: string | null;
  summary: string | null;
  category: string | null;
  feeInfo: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  registrationState: 'not_yet_open' | 'open' | 'closed';
  venues: PublicVenueRef[];
  ageLabels: string[];
  allDivisionsFull: boolean;
  schedulePublishedAt: string | null;
  isDemo: boolean;
}

export interface PublicTournamentDetail extends PublicTournamentSummary {
  description: string | null;
  rulesText: string | null;
  refundPolicyUrl: string | null;
  operationalContacts: string | null;
  divisions: PublicDivision[];
  rosterLocksAt: string | null;
  activeAlerts: PublicAnnouncement[];
}

export interface PublicTeamRef {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

export interface PublicGame {
  id: string;
  divisionId: string;
  divisionName: string;
  stage: GameStage;
  poolLabel: string | null;
  label: string | null;
  startsAt: string | null;
  durationMinutes: number;
  field: { id: string; name: string; venueId: string; venueName: string; venueSlug: string } | null;
  home: PublicTeamRef | null;
  away: PublicTeamRef | null;
  homePlaceholder: string | null;
  awayPlaceholder: string | null;
  status: GameStatus;
  resultType: GameResultType;
  homeScore: number | null;
  awayScore: number | null;
  winner: 'home' | 'away' | null;
  updatedAt: string;
  bracketRoundName: string | null;
}

export interface PublicSchedule {
  tournamentId: string;
  publishedAt: string | null;
  versionNumber: number | null;
  lastUpdatedAt: string | null;
  games: PublicGame[];
}

export interface PublicAnnouncement {
  id: string;
  tournamentId: string | null;
  tournamentSlug: string | null;
  scope: AnnouncementScope;
  scopeLabel: string;
  severity: AnnouncementSeverity;
  category: AnnouncementCategory;
  status: AnnouncementStatus;
  title: string;
  body: string;
  effectiveAt: string | null;
  expiresAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  allClearMessage: string | null;
  affectedGameIds: string[];
  linkUrl: string | null;
  source: string | null;
  authorName: string | null;
}

export interface PublicBracketSlot {
  id: string;
  position: 'top' | 'bottom';
  seed: number | null;
  isBye: boolean;
  team: PublicTeamRef | null;
  placeholder: string;
}

export interface PublicBracketMatchup {
  id: string;
  round: number;
  position: number;
  slots: [PublicBracketSlot, PublicBracketSlot];
  game: PublicGame | null;
  winnerSlot: 'top' | 'bottom' | null;
  advancesTo: { matchupId: string; slot: 'top' | 'bottom' } | null;
}

export interface PublicBracket {
  id: string;
  divisionId: string;
  divisionName: string;
  name: string;
  size: number;
  rounds: { round: number; name: string }[];
  matchups: PublicBracketMatchup[];
  publishedAt: string | null;
  updatedAt: string;
}

export interface PublicStandingsDivision {
  divisionId: string;
  divisionName: string;
  pools: {
    poolLabel: string | null;
    official: boolean;
    explanation: string[];
    rows: {
      rank: number;
      team: PublicTeamRef;
      gamesPlayed: number;
      wins: number;
      losses: number;
      ties: number;
      runsScored: number;
      runsAllowed: number;
      runDifferential: number;
      winPct: number;
      unresolvedTie: boolean;
    }[];
  }[];
}

// ---- Authenticated -------------------------------------------------------------------------

export interface MeResponse {
  user: { id: string; name: string; email: string; emailVerified: boolean; twoFactorEnabled: boolean } | null;
  roles: { role: StaffRole; tournamentId: string | null }[];
  isStaff: boolean;
}

export interface ManagerTeam {
  id: string;
  name: string;
  organizationName: string | null;
  ageGroup: string;
  city: string | null;
  state: string | null;
  coachContactName: string | null;
  coachContactPhone: string | null;
  coachContactEmail: string | null;
  rosterCount: number;
  rosterVersion: number;
  version: number;
  activeRegistrations: number;
  createdAt: string;
}

export interface RosterEntryDto {
  id: string;
  playerName: string;
  jerseyNumber: string;
}

export interface RosterDto {
  teamId: string;
  version: number;
  entries: RosterEntryDto[];
  /** Locks from registrations whose tournament roster deadline has passed. */
  locks: { registrationId: string; tournamentTitle: string; lockedAt: string }[];
  isLocked: boolean;
}

export interface RosterSnapshotDto {
  id: string;
  registrationId: string;
  revision: number;
  entries: { playerName: string; jerseyNumber: string }[];
  createdAt: string;
  reason: string | null;
}

export interface RegistrationDto {
  id: string;
  referenceCode: string;
  status: RegistrationStatus;
  paymentStatus: PaymentStatus;
  team: { id: string; name: string };
  tournament: { id: string; slug: string; title: string; startsOn: string; endsOn: string; rosterLocksAt: string | null };
  division: { id: string; name: string; ageLabel: string };
  waitlistPosition: number | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  timeline: { at: string; from: RegistrationStatus | null; to: RegistrationStatus; reason: string | null; byStaff: boolean }[];
  latestSnapshot: RosterSnapshotDto | null;
}

export interface AdminRegistrationDto extends RegistrationDto {
  manager: { id: string; name: string; email: string };
  rosterCount: number;
  notes: string | null;
}

export interface AdminTournament {
  id: string;
  slug: string;
  title: string;
  status: TournamentStatus;
  startsOn: string;
  endsOn: string;
  region: string | null;
  category: string | null;
  summary: string | null;
  description: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  rosterLocksAt: string | null;
  feeInfo: string | null;
  refundPolicyUrl: string | null;
  rulesText: string | null;
  operationalContacts: string | null;
  reviewMode: ReviewMode;
  waitlistEnabled: boolean;
  paymentRequired: boolean;
  publicTeamNames: boolean;
  fieldBufferMinutes: number;
  minTeamRestMinutes: number;
  venueIds: string[];
  isDemo: boolean;
  version: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  divisions: AdminDivision[];
  counts: { confirmed: number; pending: number; waitlisted: number; games: number; unpublishedGameChanges: number };
}

export interface AdminDivision {
  id: string;
  name: string;
  ageLabel: string;
  classification: string | null;
  capacity: number;
  rosterMin: number | null;
  rosterMax: number | null;
  allowDuplicateJersey: boolean;
  rulesText: string | null;
  gameFormat: string | null;
  defaultGameMinutes: number;
  tiesAllowedInPool: boolean;
  tiebreakers: Tiebreaker[];
  runDifferentialCap: number | null;
  standingsSignedOff: boolean;
  sortOrder: number;
  version: number;
  heldSpots: number;
  waitlisted: number;
}

export interface AdminGame {
  id: string;
  version: number;
  divisionId: string;
  stage: GameStage;
  poolLabel: string | null;
  label: string | null;
  fieldId: string | null;
  startsAt: string | null;
  date: string | null;
  time: string | null;
  durationMinutes: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homePlaceholder: string | null;
  awayPlaceholder: string | null;
  status: GameStatus;
  resultType: GameResultType;
  homeScore: number | null;
  awayScore: number | null;
  forfeitWinner: 'home' | 'away' | null;
  bracketMatchupId: string | null;
  isPublished: boolean;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
}

export interface AuditEventDto {
  id: string;
  at: string;
  actor: { id: string; name: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  tournamentId: string | null;
  reason: string | null;
  summary: string | null;
}
