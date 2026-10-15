import { describe, expect, it } from 'vitest';
import { computeStandings, validateResult, winnerSide, type StandingsGame } from '../src/results';

describe('validateResult', () => {
  it('requires both scores for a final', () => {
    expect(validateResult({ status: 'final', resultType: 'played', homeScore: 3, awayScore: null }, { tiesAllowed: true })).toHaveLength(1);
  });
  it('rejects negative, fractional and absurd scores', () => {
    expect(validateResult({ status: 'in_progress', resultType: 'played', homeScore: -1, awayScore: 1.5 }, { tiesAllowed: true })).toHaveLength(2);
    expect(validateResult({ status: 'in_progress', resultType: 'played', homeScore: 100, awayScore: 0 }, { tiesAllowed: true })).toHaveLength(1);
  });
  it('rejects ties when not allowed (bracket games)', () => {
    expect(validateResult({ status: 'final', resultType: 'played', homeScore: 2, awayScore: 2 }, { tiesAllowed: false })).toHaveLength(1);
    expect(validateResult({ status: 'final', resultType: 'played', homeScore: 2, awayScore: 2 }, { tiesAllowed: true })).toHaveLength(0);
  });
  it('requires a forfeit winner', () => {
    expect(validateResult({ status: 'final', resultType: 'forfeit', homeScore: null, awayScore: null }, { tiesAllowed: false })).toHaveLength(1);
  });
});

describe('winnerSide', () => {
  it('only reports winners for finals', () => {
    expect(winnerSide({ status: 'in_progress', resultType: 'played', homeScore: 5, awayScore: 1 })).toBeNull();
    expect(winnerSide({ status: 'final', resultType: 'played', homeScore: 5, awayScore: 1 })).toBe('home');
    expect(winnerSide({ status: 'final', resultType: 'played', homeScore: 1, awayScore: 1 })).toBeNull();
    expect(winnerSide({ status: 'final', resultType: 'forfeit', homeScore: null, awayScore: null, forfeitWinner: 'away' })).toBe('away');
  });
});

describe('computeStandings', () => {
  const teams = ['A', 'B', 'C', 'D'].map((n) => ({ id: n, name: `Team ${n}` }));
  const g = (h: string, a: string, hs: number, as: number): StandingsGame => ({ homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as, resultType: 'played' });

  it('is unofficial without signed-off tiebreakers and shares ranks on ties', () => {
    const s = computeStandings(teams, [g('A', 'B', 5, 1), g('C', 'D', 3, 2)], { tiebreakers: [], runDifferentialCap: null, signedOff: false });
    expect(s.official).toBe(false);
    expect(s.explanation[0]).toMatch(/UNOFFICIAL/);
    expect(s.rows.map((r) => [r.teamId, r.rank, r.unresolvedTie])).toEqual([
      ['A', 1, true], ['C', 1, true], ['B', 3, true], ['D', 3, true],
    ]);
  });
  it('applies configured tie-breakers in order', () => {
    const s = computeStandings(teams, [g('A', 'B', 5, 1), g('C', 'D', 3, 2)], { tiebreakers: ['run_differential'], runDifferentialCap: null, signedOff: true });
    expect(s.official).toBe(true);
    expect(s.rows.map((r) => r.teamId)).toEqual(['A', 'C', 'D', 'B']);
    expect(s.rows.every((r) => !r.unresolvedTie)).toBe(true);
  });
  it('caps run differential per game', () => {
    const s = computeStandings(teams.slice(0, 2), [g('A', 'B', 20, 0)], { tiebreakers: [], runDifferentialCap: 8, signedOff: false });
    expect(s.rows.find((r) => r.teamId === 'A')!.runDifferential).toBe(8);
  });
  it('uses head-to-head for two-team ties', () => {
    const games = [g('A', 'B', 2, 1), g('B', 'C', 9, 0), g('C', 'A', 9, 0)];
    // All 1-1. Head-to-head can't resolve a 3-way tie, so it falls through to runs_allowed.
    const s = computeStandings(teams.slice(0, 3), games, { tiebreakers: ['head_to_head', 'runs_allowed'], runDifferentialCap: null, signedOff: true });
    expect(s.rows.map((r) => r.teamId)).toEqual(['B', 'C', 'A']);
    const two = computeStandings(teams.slice(0, 2), [g('A', 'B', 2, 1), g('B', 'A', 1, 0)], { tiebreakers: ['head_to_head'], runDifferentialCap: null, signedOff: true });
    expect(two.rows.every((r) => r.unresolvedTie)).toBe(true);
  });
  it('lists teams that have not played after teams with losses', () => {
    const s = computeStandings(teams.slice(0, 3), [g('A', 'B', 5, 1)], { tiebreakers: [], runDifferentialCap: null, signedOff: false });
    expect(s.rows.map((r) => [r.teamId, r.rank])).toEqual([['A', 1], ['B', 2], ['C', 3]]);
  });
  it('counts forfeits in record but not runs', () => {
    const s = computeStandings(teams.slice(0, 2), [{ homeTeamId: 'A', awayTeamId: 'B', homeScore: null, awayScore: null, resultType: 'forfeit', forfeitWinner: 'away' }], { tiebreakers: [], runDifferentialCap: null, signedOff: false });
    const b = s.rows.find((r) => r.teamId === 'B')!;
    expect([b.wins, b.runsScored]).toEqual([1, 0]);
  });
});
