// Score validation, winner determination and pool standings (spec §10).
// Tie-breakers are *never* assumed: with none configured, standings are labeled unofficial.

import type { GameResultType, GameStatus } from './enums';

export const MAX_RUNS = 99;

export interface ResultInput {
  status: GameStatus;
  resultType: GameResultType;
  homeScore: number | null;
  awayScore: number | null;
  /** Required for forfeits: which side won. */
  forfeitWinner?: 'home' | 'away' | null;
}

export interface ResultProblem {
  field: string;
  message: string;
}

const validRuns = (n: number | null) => n === null || (Number.isInteger(n) && n >= 0 && n <= MAX_RUNS);

export function validateResult(r: ResultInput, opts: { tiesAllowed: boolean }): ResultProblem[] {
  const p: ResultProblem[] = [];
  if (!validRuns(r.homeScore)) p.push({ field: 'homeScore', message: `Runs must be a whole number from 0 to ${MAX_RUNS}.` });
  if (!validRuns(r.awayScore)) p.push({ field: 'awayScore', message: `Runs must be a whole number from 0 to ${MAX_RUNS}.` });
  if (r.status !== 'final') return p;
  if (r.resultType === 'forfeit') {
    if (!r.forfeitWinner) p.push({ field: 'forfeitWinner', message: 'Choose which team won by forfeit.' });
    return p;
  }
  if (r.homeScore === null || r.awayScore === null) {
    p.push({ field: 'score', message: 'A final game needs a score for both teams.' });
  } else if (r.homeScore === r.awayScore && !opts.tiesAllowed) {
    p.push({ field: 'score', message: 'This game cannot end in a tie. Enter the deciding score.' });
  }
  return p;
}

/** Winner side of a final result, or null for a tie / non-final game. */
export function winnerSide(r: ResultInput): 'home' | 'away' | null {
  if (r.status !== 'final') return null;
  if (r.resultType === 'forfeit') return r.forfeitWinner ?? null;
  if (r.homeScore === null || r.awayScore === null || r.homeScore === r.awayScore) return null;
  return r.homeScore > r.awayScore ? 'home' : 'away';
}

// ---------------------------------------------------------------------------------------
// Standings

export const TIEBREAKERS = ['head_to_head', 'runs_allowed', 'run_differential', 'runs_scored'] as const;
export type Tiebreaker = (typeof TIEBREAKERS)[number];

export const TIEBREAKER_LABELS: Record<Tiebreaker, string> = {
  head_to_head: 'Head-to-head result (two-team ties only)',
  runs_allowed: 'Fewest runs allowed',
  run_differential: 'Run differential',
  runs_scored: 'Most runs scored',
};

export interface StandingsConfig {
  tiebreakers: Tiebreaker[];
  /** Max run differential credited per game; null = uncapped. */
  runDifferentialCap: number | null;
  /** Director has signed off on the policy (spec §10). */
  signedOff: boolean;
}

export interface StandingsGame {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  resultType: GameResultType;
  forfeitWinner?: 'home' | 'away' | null;
}

export interface StandingsRow {
  teamId: string;
  teamName: string;
  rank: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  runsScored: number;
  runsAllowed: number;
  runDifferential: number;
  winPct: number;
  /** True when the row shares its rank with another team after all configured tie-breakers. */
  unresolvedTie: boolean;
}

export interface Standings {
  rows: StandingsRow[];
  official: boolean;
  explanation: string[];
}

export function computeStandings(
  teams: { id: string; name: string }[],
  games: StandingsGame[],
  config: StandingsConfig,
): Standings {
  const rows = new Map<string, StandingsRow>(
    teams.map((t) => [
      t.id,
      {
        teamId: t.id,
        teamName: t.name,
        rank: 0,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        runsScored: 0,
        runsAllowed: 0,
        runDifferential: 0,
        winPct: 0,
        unresolvedTie: false,
      },
    ]),
  );
  const cap = config.runDifferentialCap;

  for (const g of games) {
    const home = rows.get(g.homeTeamId);
    const away = rows.get(g.awayTeamId);
    if (!home || !away) continue;
    home.gamesPlayed++;
    away.gamesPlayed++;
    if (g.resultType === 'forfeit') {
      // Forfeits count in the record only; runs policy for forfeits is an owner decision.
      if (g.forfeitWinner === 'home') (home.wins++, away.losses++);
      else if (g.forfeitWinner === 'away') (away.wins++, home.losses++);
      continue;
    }
    const hs = g.homeScore ?? 0;
    const as = g.awayScore ?? 0;
    home.runsScored += hs;
    home.runsAllowed += as;
    away.runsScored += as;
    away.runsAllowed += hs;
    const diff = cap === null ? hs - as : Math.max(-cap, Math.min(cap, hs - as));
    home.runDifferential += diff;
    away.runDifferential -= diff;
    if (hs > as) (home.wins++, away.losses++);
    else if (as > hs) (away.wins++, home.losses++);
    else (home.ties++, away.ties++);
  }

  for (const r of rows.values()) {
    r.winPct = r.gamesPlayed === 0 ? 0 : (r.wins + r.ties * 0.5) / r.gamesPlayed;
  }

  // Teams with no final games have no winning percentage: they rank after everyone who has played.
  const played = [...rows.values()].filter((r) => r.gamesPlayed > 0);
  const notPlayed = [...rows.values()].filter((r) => r.gamesPlayed === 0);
  const groups = splitBy(played, (a, b) => b.winPct - a.winPct);
  const ordered: StandingsRow[][] = [];
  for (const g of groups) ordered.push(...breakTies(g, config.tiebreakers, games));
  if (notPlayed.length) ordered.push(notPlayed);

  let rank = 1;
  const result: StandingsRow[] = [];
  for (const group of ordered) {
    const sorted = [...group].sort((a, b) => a.teamName.localeCompare(b.teamName));
    for (const r of sorted) {
      r.rank = rank;
      r.unresolvedTie = group.length > 1;
      result.push(r);
    }
    rank += group.length;
  }

  const official = config.signedOff && config.tiebreakers.length > 0;
  const explanation = [
    'Ranked by winning percentage (ties count as half a win). Only final games are included.',
    config.tiebreakers.length
      ? `Ties broken in order by: ${config.tiebreakers.map((t) => TIEBREAKER_LABELS[t]).join('; ')}.`
      : 'No tie-breakers have been configured for this division.',
    cap === null ? 'Run differential is not capped.' : `Run differential is capped at ${cap} per game.`,
    'Forfeits count toward win–loss record but not runs.',
    'Teams without a final game yet are listed last.',
  ];
  if (!official) explanation.unshift('UNOFFICIAL: tie-breaker policy has not been signed off. Seeding is set by the tournament director.');

  return { rows: result, official, explanation };
}

function splitBy<T>(items: T[], cmp: (a: T, b: T) => number): T[][] {
  const sorted = [...items].sort(cmp);
  const out: T[][] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && cmp(last[0]!, it) === 0) last.push(it);
    else out.push([it]);
  }
  return out;
}

function breakTies(group: StandingsRow[], tbs: Tiebreaker[], games: StandingsGame[]): StandingsRow[][] {
  if (group.length <= 1 || tbs.length === 0) return [group];
  const [tb, ...rest] = tbs as [Tiebreaker, ...Tiebreaker[]];
  let parts: StandingsRow[][];
  switch (tb) {
    case 'runs_allowed':
      parts = splitBy(group, (a, b) => a.runsAllowed - b.runsAllowed);
      break;
    case 'run_differential':
      parts = splitBy(group, (a, b) => b.runDifferential - a.runDifferential);
      break;
    case 'runs_scored':
      parts = splitBy(group, (a, b) => b.runsScored - a.runsScored);
      break;
    case 'head_to_head': {
      if (group.length !== 2) {
        parts = [group];
        break;
      }
      const [a, b] = group as [StandingsRow, StandingsRow];
      let net = 0;
      for (const g of games) {
        const w = g.resultType === 'forfeit'
          ? g.forfeitWinner === 'home' ? g.homeTeamId : g.forfeitWinner === 'away' ? g.awayTeamId : null
          : (g.homeScore ?? 0) > (g.awayScore ?? 0) ? g.homeTeamId : (g.awayScore ?? 0) > (g.homeScore ?? 0) ? g.awayTeamId : null;
        const involves = new Set([g.homeTeamId, g.awayTeamId]);
        if (!involves.has(a.teamId) || !involves.has(b.teamId)) continue;
        if (w === a.teamId) net++;
        else if (w === b.teamId) net--;
      }
      parts = net > 0 ? [[a], [b]] : net < 0 ? [[b], [a]] : [group];
      break;
    }
  }
  return parts.flatMap((p) => breakTies(p, rest, games));
}
