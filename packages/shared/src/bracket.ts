// Single-elimination bracket structure and graph rules (spec §10).
// Only single elimination is implemented; other formats are explicitly unsupported.

export const SUPPORTED_BRACKET_FORMATS = ['single_elimination'] as const;
export type BracketFormat = (typeof SUPPORTED_BRACKET_FORMATS)[number];

export const UNSUPPORTED_BRACKET_FORMATS = [
  'double_elimination',
  'consolation',
  'multi_game_guarantee',
] as const;

export type SlotPosition = 'top' | 'bottom';

export interface BracketSlotPlan {
  position: SlotPosition;
  /** Seed number feeding this slot in round 1; null for later rounds. */
  seed: number | null;
  isBye: boolean;
}

export interface BracketMatchupPlan {
  key: string; // "R1M1"
  round: number; // 1-based
  position: number; // 1-based within round, top to bottom
  slots: [BracketSlotPlan, BracketSlotPlan];
}

export interface BracketEdgePlan {
  from: string;
  to: string;
  toSlot: SlotPosition;
}

export interface BracketPlan {
  size: number;
  entrants: number;
  rounds: { round: number; name: string }[];
  matchups: BracketMatchupPlan[];
  edges: BracketEdgePlan[];
}

export const isPowerOfTwo = (n: number) => Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;
export const nextPowerOfTwo = (n: number) => {
  let p = 2;
  while (p < n) p *= 2;
  return p;
};

/** Standard bracket seed order so 1 and 2 can only meet in the final: 8 → [1,8,4,5,2,7,3,6]. */
export function seedOrder(size: number): number[] {
  if (!isPowerOfTwo(size)) throw new Error('Bracket size must be a power of two.');
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  return order;
}

export function roundName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Championship';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round of ${2 ** (fromEnd + 1)}`;
}

export const MAX_BRACKET_SIZE = 64;

/**
 * Build a single-elimination plan. `entrants` teams occupy seeds 1..entrants; remaining seeds
 * are byes, which land against the top seeds. Requires entrants > size/2 so no matchup has two byes.
 */
export function buildSingleElimination({ size, entrants }: { size: number; entrants: number }): BracketPlan {
  if (!isPowerOfTwo(size) || size > MAX_BRACKET_SIZE) {
    throw new Error(`Bracket size must be a power of two between 2 and ${MAX_BRACKET_SIZE}.`);
  }
  if (!Number.isInteger(entrants) || entrants < 2 || entrants > size) {
    throw new Error('Number of teams must be between 2 and the bracket size.');
  }
  if (entrants <= size / 2) {
    throw new Error(`${entrants} teams fit a bracket of ${size / 2}; choose the smaller size to avoid double byes.`);
  }
  const totalRounds = Math.log2(size);
  const order = seedOrder(size);
  const matchups: BracketMatchupPlan[] = [];
  const edges: BracketEdgePlan[] = [];

  for (let r = 1; r <= totalRounds; r++) {
    const count = size / 2 ** r;
    for (let p = 1; p <= count; p++) {
      const key = `R${r}M${p}`;
      let slots: [BracketSlotPlan, BracketSlotPlan];
      if (r === 1) {
        const top = order[(p - 1) * 2]!;
        const bottom = order[(p - 1) * 2 + 1]!;
        slots = [
          { position: 'top', seed: top, isBye: top > entrants },
          { position: 'bottom', seed: bottom, isBye: bottom > entrants },
        ];
      } else {
        slots = [
          { position: 'top', seed: null, isBye: false },
          { position: 'bottom', seed: null, isBye: false },
        ];
      }
      matchups.push({ key, round: r, position: p, slots });
      if (r < totalRounds) {
        edges.push({ from: key, to: `R${r + 1}M${Math.ceil(p / 2)}`, toSlot: p % 2 === 1 ? 'top' : 'bottom' });
      }
    }
  }

  return {
    size,
    entrants,
    rounds: Array.from({ length: totalRounds }, (_, i) => ({ round: i + 1, name: roundName(i + 1, totalRounds) })),
    matchups,
    edges,
  };
}

export interface GraphMatchup {
  id: string;
  round: number;
}
export interface GraphEdge {
  fromMatchupId: string;
  toMatchupId: string;
  toSlot: SlotPosition;
}

export interface GraphProblem {
  code: 'DUPLICATE_DESTINATION' | 'MULTIPLE_OUTGOING' | 'BACKWARD_EDGE' | 'UNKNOWN_MATCHUP' | 'CYCLE';
  message: string;
}

/** Structural integrity checks backing the DB constraints (spec §14 bracket rules). */
export function validateBracketGraph(matchups: GraphMatchup[], edges: GraphEdge[]): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const byId = new Map(matchups.map((m) => [m.id, m]));
  const dest = new Set<string>();
  const outgoing = new Set<string>();
  for (const e of edges) {
    const from = byId.get(e.fromMatchupId);
    const to = byId.get(e.toMatchupId);
    if (!from || !to) {
      problems.push({ code: 'UNKNOWN_MATCHUP', message: 'Edge references a matchup outside this bracket.' });
      continue;
    }
    const d = `${e.toMatchupId}:${e.toSlot}`;
    if (dest.has(d)) problems.push({ code: 'DUPLICATE_DESTINATION', message: 'Two matchups advance into the same slot.' });
    dest.add(d);
    if (outgoing.has(e.fromMatchupId)) problems.push({ code: 'MULTIPLE_OUTGOING', message: 'A matchup winner advances to more than one slot.' });
    outgoing.add(e.fromMatchupId);
    if (to.round <= from.round) problems.push({ code: 'BACKWARD_EDGE', message: 'Advancement must move to a later round.' });
  }
  // Rounds strictly increase along edges, so a cycle implies a backward edge; still verify explicitly.
  const next = new Map(edges.map((e) => [e.fromMatchupId, e.toMatchupId]));
  for (const m of matchups) {
    const seen = new Set<string>();
    let cur: string | undefined = m.id;
    while (cur) {
      if (seen.has(cur)) {
        problems.push({ code: 'CYCLE', message: 'Bracket advancement contains a cycle.' });
        break;
      }
      seen.add(cur);
      cur = next.get(cur);
    }
  }
  return problems;
}

/** All matchups reachable from `fromMatchupId` along advancement edges, nearest first. */
export function downstreamOf(fromMatchupId: string, edges: GraphEdge[]): { matchupId: string; viaSlot: SlotPosition }[] {
  const next = new Map(edges.map((e) => [e.fromMatchupId, e]));
  const out: { matchupId: string; viaSlot: SlotPosition }[] = [];
  const seen = new Set<string>([fromMatchupId]);
  let e = next.get(fromMatchupId);
  while (e && !seen.has(e.toMatchupId)) {
    out.push({ matchupId: e.toMatchupId, viaSlot: e.toSlot });
    seen.add(e.toMatchupId);
    e = next.get(e.toMatchupId);
  }
  return out;
}
