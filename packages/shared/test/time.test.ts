import { describe, expect, it } from 'vitest';
import { easternDateKey, easternTimeKey, easternWallTimeToUtc, formatDateRange } from '../src/time';

describe('Eastern time conversion', () => {
  it('converts EDT and EST wall times', () => {
    expect(easternWallTimeToUtc('2026-07-04', '09:00').toISOString()).toBe('2026-07-04T13:00:00.000Z');
    expect(easternWallTimeToUtc('2026-01-10', '09:00').toISOString()).toBe('2026-01-10T14:00:00.000Z');
  });
  it('handles spring-forward gap by moving forward', () => {
    // 2026-03-08 02:30 does not exist in New York.
    expect(easternWallTimeToUtc('2026-03-08', '02:30').toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(easternTimeKey(easternWallTimeToUtc('2026-03-08', '02:30'))).toBe('03:30');
  });
  it('resolves ambiguous fall-back time to first occurrence (EDT)', () => {
    expect(easternWallTimeToUtc('2026-11-01', '01:30').toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
  it('round-trips date and time keys', () => {
    const d = easternWallTimeToUtc('2026-04-18', '23:45');
    expect(easternDateKey(d)).toBe('2026-04-18');
    expect(easternTimeKey(d)).toBe('23:45');
  });
  it('rejects malformed input', () => {
    expect(() => easternWallTimeToUtc('2026-4-18', '9:00')).toThrow();
  });
  it('formats date ranges compactly', () => {
    expect(formatDateRange('2026-04-18', '2026-04-19')).toBe('Apr 18–19, 2026');
    expect(formatDateRange('2026-04-30', '2026-05-01')).toBe('Apr 30 – May 1, 2026');
  });
});
