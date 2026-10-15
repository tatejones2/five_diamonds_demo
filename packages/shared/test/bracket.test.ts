import { describe, expect, it } from 'vitest';
import { buildSingleElimination, downstreamOf, seedOrder, validateBracketGraph } from '../src/bracket';

describe('seedOrder', () => {
  it('produces standard order', () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

describe('buildSingleElimination', () => {
  it('builds a 4-team bracket', () => {
    const p = buildSingleElimination({ size: 4, entrants: 4 });
    expect(p.rounds.map((r) => r.name)).toEqual(['Semifinals', 'Championship']);
    expect(p.matchups).toHaveLength(3);
    expect(p.edges).toEqual([
      { from: 'R1M1', to: 'R2M1', toSlot: 'top' },
      { from: 'R1M2', to: 'R2M1', toSlot: 'bottom' },
    ]);
    expect(p.matchups[0]!.slots.map((s) => s.seed)).toEqual([1, 4]);
  });
  it('gives byes to top seeds when entrants < size', () => {
    const p = buildSingleElimination({ size: 8, entrants: 6 });
    const byes = p.matchups.filter((m) => m.round === 1 && m.slots.some((s) => s.isBye));
    expect(byes).toHaveLength(2);
    const byeOpponents = byes.map((m) => m.slots.find((s) => !s.isBye)!.seed).sort();
    expect(byeOpponents).toEqual([1, 2]);
    expect(p.rounds.map((r) => r.name)).toEqual(['Quarterfinals', 'Semifinals', 'Championship']);
  });
  it('rejects double-bye configurations and bad sizes', () => {
    expect(() => buildSingleElimination({ size: 8, entrants: 4 })).toThrow(/smaller size/);
    expect(() => buildSingleElimination({ size: 6, entrants: 6 })).toThrow(/power of two/);
    expect(() => buildSingleElimination({ size: 4, entrants: 1 })).toThrow();
  });
  it('produces a valid acyclic graph for every supported size', () => {
    for (const size of [2, 4, 8, 16, 32, 64]) {
      const p = buildSingleElimination({ size, entrants: size });
      const problems = validateBracketGraph(
        p.matchups.map((m) => ({ id: m.key, round: m.round })),
        p.edges.map((e) => ({ fromMatchupId: e.from, toMatchupId: e.to, toSlot: e.toSlot })),
      );
      expect(problems).toEqual([]);
      expect(p.matchups).toHaveLength(size - 1);
    }
  });
});

describe('validateBracketGraph', () => {
  const m = [{ id: 'a', round: 1 }, { id: 'b', round: 1 }, { id: 'c', round: 2 }];
  it('detects duplicate destinations, backward edges and multiple outgoing', () => {
    const problems = validateBracketGraph(m, [
      { fromMatchupId: 'a', toMatchupId: 'c', toSlot: 'top' },
      { fromMatchupId: 'b', toMatchupId: 'c', toSlot: 'top' },
      { fromMatchupId: 'c', toMatchupId: 'a', toSlot: 'top' },
      { fromMatchupId: 'a', toMatchupId: 'c', toSlot: 'bottom' },
    ]).map((p) => p.code);
    expect(problems).toContain('DUPLICATE_DESTINATION');
    expect(problems).toContain('BACKWARD_EDGE');
    expect(problems).toContain('MULTIPLE_OUTGOING');
    expect(problems).toContain('CYCLE');
  });
});

describe('downstreamOf', () => {
  it('walks to the final', () => {
    const p = buildSingleElimination({ size: 8, entrants: 8 });
    const edges = p.edges.map((e) => ({ fromMatchupId: e.from, toMatchupId: e.to, toSlot: e.toSlot }));
    expect(downstreamOf('R1M3', edges)).toEqual([
      { matchupId: 'R2M2', viaSlot: 'top' },
      { matchupId: 'R3M1', viaSlot: 'bottom' },
    ]);
    expect(downstreamOf('R3M1', edges)).toEqual([]);
  });
});
