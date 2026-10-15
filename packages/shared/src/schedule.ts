// Pure schedule validation (spec §9.5). The API runs this inside the publish transaction
// against locked rows; the admin UI runs the same code for instant feedback.

import type { GameStatus } from './enums';

export interface ScheduleGame {
  id: string;
  label?: string;
  divisionId: string;
  fieldId: string | null;
  startsAt: Date | string | null;
  durationMinutes: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homePlaceholder?: string | null;
  awayPlaceholder?: string | null;
  status: GameStatus;
  stage: string;
  poolLabel?: string | null;
}

export interface TimeWindow {
  start: Date | string;
  end: Date | string;
}

export interface ScheduleConstraints {
  /** Required turnaround on the same field between games (warning if violated). */
  fieldBufferMinutes?: number;
  /** Minimum rest for a team between its games (warning if violated). */
  minTeamRestMinutes?: number;
  /** Availability windows per field id. Fields without an entry are unconstrained. */
  fieldAvailability?: Record<string, TimeWindow[]>;
  /** Team ids eligible per division (confirmed registrations). Omit to skip the check. */
  eligibleTeamsByDivision?: Record<string, string[]>;
  /** Treat repeat pool matchups as errors instead of warnings. */
  duplicateMatchupIsError?: boolean;
}

export type ScheduleIssueCode =
  | 'FIELD_OVERLAP'
  | 'TEAM_OVERLAP'
  | 'FIELD_TURNAROUND'
  | 'MIN_REST'
  | 'MISSING_TIME'
  | 'MISSING_FIELD'
  | 'MISSING_TEAM'
  | 'SAME_TEAM_BOTH_SIDES'
  | 'DUPLICATE_MATCHUP'
  | 'OUTSIDE_FIELD_AVAILABILITY'
  | 'TEAM_NOT_IN_DIVISION'
  | 'INVALID_DURATION';

export interface ScheduleIssue {
  severity: 'error' | 'warning';
  code: ScheduleIssueCode;
  message: string;
  gameIds: string[];
}

/** Statuses that no longer occupy a field/time slot. */
const INACTIVE: ReadonlySet<GameStatus> = new Set(['canceled', 'postponed']);

interface Interval {
  game: ScheduleGame;
  start: number;
  end: number;
}

const ms = (m: number) => m * 60_000;
const name = (g: ScheduleGame) => g.label ?? `Game ${g.id.slice(0, 8)}`;

export function validateSchedule(games: ScheduleGame[], c: ScheduleConstraints = {}): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const timed: Interval[] = [];

  for (const g of games) {
    if (INACTIVE.has(g.status)) continue;
    if (!Number.isInteger(g.durationMinutes) || g.durationMinutes <= 0 || g.durationMinutes > 24 * 60) {
      issues.push({ severity: 'error', code: 'INVALID_DURATION', message: `${name(g)} has an invalid duration.`, gameIds: [g.id] });
      continue;
    }
    if (!g.startsAt) {
      issues.push({ severity: 'error', code: 'MISSING_TIME', message: `${name(g)} has no start time.`, gameIds: [g.id] });
    }
    if (!g.fieldId) {
      issues.push({ severity: 'error', code: 'MISSING_FIELD', message: `${name(g)} has no field assigned.`, gameIds: [g.id] });
    }
    const homeKnown = g.homeTeamId ?? (g.homePlaceholder?.trim() || null);
    const awayKnown = g.awayTeamId ?? (g.awayPlaceholder?.trim() || null);
    if (!homeKnown || !awayKnown) {
      issues.push({
        severity: 'error',
        code: 'MISSING_TEAM',
        message: `${name(g)} needs a team or placeholder for both sides.`,
        gameIds: [g.id],
      });
    }
    if (g.homeTeamId && g.homeTeamId === g.awayTeamId) {
      issues.push({ severity: 'error', code: 'SAME_TEAM_BOTH_SIDES', message: `${name(g)} lists the same team twice.`, gameIds: [g.id] });
    }
    const eligible = c.eligibleTeamsByDivision?.[g.divisionId];
    if (eligible) {
      for (const t of [g.homeTeamId, g.awayTeamId]) {
        if (t && !eligible.includes(t)) {
          issues.push({
            severity: 'error',
            code: 'TEAM_NOT_IN_DIVISION',
            message: `${name(g)} includes a team that is not confirmed in this division.`,
            gameIds: [g.id],
          });
        }
      }
    }
    if (g.startsAt) {
      const start = new Date(g.startsAt).getTime();
      timed.push({ game: g, start, end: start + ms(g.durationMinutes) });
    }
  }

  // Field availability
  for (const iv of timed) {
    const windows = iv.game.fieldId ? c.fieldAvailability?.[iv.game.fieldId] : undefined;
    if (!windows) continue;
    const inside = windows.some((w) => iv.start >= new Date(w.start).getTime() && iv.end <= new Date(w.end).getTime());
    if (!inside) {
      issues.push({
        severity: 'error',
        code: 'OUTSIDE_FIELD_AVAILABILITY',
        message: `${name(iv.game)} is scheduled outside the field's available hours.`,
        gameIds: [iv.game.id],
      });
    }
  }

  // Field overlap / turnaround
  const byField = groupBy(timed.filter((i) => i.game.fieldId), (i) => i.game.fieldId!);
  const buffer = ms(c.fieldBufferMinutes ?? 0);
  for (const list of byField.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (b.start >= a.end + buffer) break;
        if (b.start < a.end) {
          issues.push({
            severity: 'error',
            code: 'FIELD_OVERLAP',
            message: `${name(a.game)} and ${name(b.game)} overlap on the same field.`,
            gameIds: [a.game.id, b.game.id],
          });
        } else {
          issues.push({
            severity: 'warning',
            code: 'FIELD_TURNAROUND',
            message: `${name(a.game)} and ${name(b.game)} leave less than ${c.fieldBufferMinutes} min field turnaround.`,
            gameIds: [a.game.id, b.game.id],
          });
        }
      }
    }
  }

  // Team overlap / rest
  const byTeam = new Map<string, Interval[]>();
  for (const iv of timed) {
    for (const t of new Set([iv.game.homeTeamId, iv.game.awayTeamId])) {
      if (!t) continue;
      if (!byTeam.has(t)) byTeam.set(t, []);
      byTeam.get(t)!.push(iv);
    }
  }
  const rest = ms(c.minTeamRestMinutes ?? 0);
  for (const list of byTeam.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (b.start >= a.end + rest) break;
        if (b.start < a.end) {
          issues.push({
            severity: 'error',
            code: 'TEAM_OVERLAP',
            message: `A team is scheduled in overlapping games: ${name(a.game)} and ${name(b.game)}.`,
            gameIds: [a.game.id, b.game.id],
          });
        } else {
          issues.push({
            severity: 'warning',
            code: 'MIN_REST',
            message: `A team has less than ${c.minTeamRestMinutes} min rest between ${name(a.game)} and ${name(b.game)}.`,
            gameIds: [a.game.id, b.game.id],
          });
        }
      }
    }
  }

  // Duplicate matchups within the same division + stage + pool
  const seen = new Map<string, ScheduleGame>();
  for (const g of games) {
    if (INACTIVE.has(g.status) || !g.homeTeamId || !g.awayTeamId) continue;
    const pair = [g.homeTeamId, g.awayTeamId].sort().join('|');
    const key = `${g.divisionId}|${g.stage}|${g.poolLabel ?? ''}|${pair}`;
    const prior = seen.get(key);
    if (prior) {
      issues.push({
        severity: c.duplicateMatchupIsError ? 'error' : 'warning',
        code: 'DUPLICATE_MATCHUP',
        message: `${name(prior)} and ${name(g)} are the same matchup.`,
        gameIds: [prior.id, g.id],
      });
    } else {
      seen.set(key, g);
    }
  }

  return issues;
}

export const hasBlockingIssues = (issues: ScheduleIssue[]) => issues.some((i) => i.severity === 'error');

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return m;
}

/** Generate evenly spaced start slots for a field/day (spec §9.1 "sensible slot creation"). */
export function generateSlots(opts: {
  firstStart: Date;
  lastStartNoLaterThan: Date;
  durationMinutes: number;
  bufferMinutes: number;
}): Date[] {
  const step = ms(opts.durationMinutes + opts.bufferMinutes);
  if (step <= 0) return [];
  const out: Date[] = [];
  for (let t = opts.firstStart.getTime(); t <= opts.lastStartNoLaterThan.getTime(); t += step) {
    out.push(new Date(t));
    if (out.length > 200) break;
  }
  return out;
}
