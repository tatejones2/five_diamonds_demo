import { describe, expect, it } from 'vitest';
import { generateSlots, hasBlockingIssues, validateSchedule, type ScheduleGame } from '../src/schedule';

const base = (o: Partial<ScheduleGame> & { id: string }): ScheduleGame => ({
  divisionId: 'd1',
  fieldId: 'f1',
  startsAt: '2026-04-18T13:00:00Z',
  durationMinutes: 90,
  homeTeamId: 'a',
  awayTeamId: 'b',
  status: 'scheduled',
  stage: 'pool',
  ...o,
});
const codes = (g: ScheduleGame[], c = {}) => validateSchedule(g, c).map((i) => `${i.severity}:${i.code}`);

describe('validateSchedule', () => {
  it('accepts a clean schedule', () => {
    const games = [base({ id: '1' }), base({ id: '2', startsAt: '2026-04-18T14:30:00Z', homeTeamId: 'c', awayTeamId: 'd' })];
    expect(validateSchedule(games)).toEqual([]);
  });
  it('blocks field overlap', () => {
    const games = [base({ id: '1' }), base({ id: '2', startsAt: '2026-04-18T14:00:00Z', homeTeamId: 'c', awayTeamId: 'd' })];
    expect(codes(games)).toEqual(['error:FIELD_OVERLAP']);
    expect(hasBlockingIssues(validateSchedule(games))).toBe(true);
  });
  it('treats back-to-back as fine but warns under turnaround buffer', () => {
    const games = [base({ id: '1' }), base({ id: '2', startsAt: '2026-04-18T14:30:00Z', homeTeamId: 'c', awayTeamId: 'd' })];
    expect(codes(games, { fieldBufferMinutes: 15 })).toEqual(['warning:FIELD_TURNAROUND']);
  });
  it('blocks a team in two overlapping games on different fields', () => {
    const games = [base({ id: '1' }), base({ id: '2', fieldId: 'f2', awayTeamId: 'c', startsAt: '2026-04-18T13:30:00Z' })];
    expect(codes(games)).toEqual(['error:TEAM_OVERLAP']);
  });
  it('warns on minimum rest', () => {
    const games = [base({ id: '1' }), base({ id: '2', fieldId: 'f2', awayTeamId: 'c', startsAt: '2026-04-18T15:00:00Z' })];
    expect(codes(games, { minTeamRestMinutes: 60 })).toEqual(['warning:MIN_REST']);
  });
  it('ignores canceled and postponed games for conflicts', () => {
    const games = [base({ id: '1' }), base({ id: '2', status: 'canceled', homeTeamId: 'c', awayTeamId: 'd' })];
    expect(validateSchedule(games)).toEqual([]);
  });
  it('requires time, field and both sides', () => {
    expect(codes([base({ id: '1', startsAt: null, fieldId: null, awayTeamId: null })])).toEqual([
      'error:MISSING_TIME',
      'error:MISSING_FIELD',
      'error:MISSING_TEAM',
    ]);
  });
  it('accepts placeholders for bracket games', () => {
    expect(validateSchedule([base({ id: '1', homeTeamId: null, awayTeamId: null, homePlaceholder: 'Winner G1', awayPlaceholder: 'Winner G2' })])).toEqual([]);
  });
  it('flags same team on both sides once', () => {
    expect(codes([base({ id: '1', awayTeamId: 'a' })])).toEqual(['error:SAME_TEAM_BOTH_SIDES']);
  });
  it('flags duplicate matchups as warnings by default', () => {
    const games = [base({ id: '1' }), base({ id: '2', homeTeamId: 'b', awayTeamId: 'a', fieldId: 'f2', startsAt: '2026-04-18T20:00:00Z' })];
    expect(codes(games)).toEqual(['warning:DUPLICATE_MATCHUP']);
    expect(codes(games, { duplicateMatchupIsError: true })).toEqual(['error:DUPLICATE_MATCHUP']);
  });
  it('blocks games outside field availability', () => {
    const c = { fieldAvailability: { f1: [{ start: '2026-04-18T12:00:00Z', end: '2026-04-18T14:00:00Z' }] } };
    expect(codes([base({ id: '1' })], c)).toEqual(['error:OUTSIDE_FIELD_AVAILABILITY']);
  });
  it('blocks teams not confirmed in the division', () => {
    expect(codes([base({ id: '1' })], { eligibleTeamsByDivision: { d1: ['a'] } })).toEqual(['error:TEAM_NOT_IN_DIVISION']);
  });
  it('detects overlap with a long earlier game that spans several later games', () => {
    const games = [
      base({ id: '1', durationMinutes: 300 }),
      base({ id: '2', startsAt: '2026-04-18T15:00:00Z', homeTeamId: 'c', awayTeamId: 'd' }),
      base({ id: '3', startsAt: '2026-04-18T16:00:00Z', homeTeamId: 'e', awayTeamId: 'f' }),
    ];
    expect(codes(games).filter((c) => c === 'error:FIELD_OVERLAP')).toHaveLength(3);
  });
});

describe('generateSlots', () => {
  it('spaces slots by duration + buffer', () => {
    const s = generateSlots({
      firstStart: new Date('2026-04-18T12:00:00Z'),
      lastStartNoLaterThan: new Date('2026-04-18T18:00:00Z'),
      durationMinutes: 90,
      bufferMinutes: 30,
    });
    expect(s.map((d) => d.toISOString().slice(11, 16))).toEqual(['12:00', '14:00', '16:00', '18:00']);
  });
});
