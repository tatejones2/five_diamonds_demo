import type { PublicBracket, PublicBracketMatchup, PublicBracketSlot } from '@fd/shared';
import { formatEasternDay, formatEasternTime } from '../lib/format';
import { GameStatusBadge } from './status';
import { cx } from './ui';

function SlotRow({ slot, score, winner, showScore }: { slot: PublicBracketSlot; score: number | null; winner: boolean; showScore: boolean }) {
  return (
    <div className={cx('flex items-center justify-between gap-2 px-3 py-2', winner && 'bg-brand-sky-soft')}>
      <span className="flex min-w-0 items-center gap-2">
        {slot.seed !== null && <span className="tabular w-5 shrink-0 text-right text-xs font-semibold text-ink-subtle">{slot.seed}</span>}
        <span className={cx('truncate text-sm', slot.team ? 'font-semibold text-ink' : 'italic text-ink-subtle', winner && 'text-brand-navy')}>
          {slot.team?.name ?? slot.placeholder}
          {winner && <span className="sr-only"> (advanced)</span>}
        </span>
      </span>
      {showScore && <span className="tabular font-display font-semibold text-ink">{score ?? '–'}</span>}
    </div>
  );
}

function MatchupBox({ m }: { m: PublicBracketMatchup }) {
  const g = m.game;
  const bye = m.slots.some((s) => s.isBye);
  const showScore = !!g && (g.status === 'final' || g.status === 'in_progress');
  return (
    <div className="w-60 overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <div className="divide-y divide-line">
        <SlotRow slot={m.slots[0]} score={g?.homeScore ?? null} winner={m.winnerSlot === 'top'} showScore={showScore} />
        <SlotRow slot={m.slots[1]} score={g?.awayScore ?? null} winner={m.winnerSlot === 'bottom'} showScore={showScore} />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-alt px-3 py-1.5 text-[11px] text-ink-muted">
        <span className="truncate">{bye ? 'Bye — advances' : g?.startsAt ? `${formatEasternDay(g.startsAt)} ${formatEasternTime(g.startsAt)}${g.field ? ` · ${g.field.name}` : ''}` : 'Time TBD'}</span>
        {g && <GameStatusBadge status={g.status} />}
      </div>
    </div>
  );
}

/** Desktop: visual tree. Mobile: round-by-round list. Both are real DOM (no canvas), spec §10. */
export function BracketView({ b }: { b: PublicBracket }) {
  const rounds = b.rounds.map((r) => ({ ...r, matchups: b.matchups.filter((m) => m.round === r.round).sort((a, c) => a.position - c.position) }));
  const firstCount = rounds[0]?.matchups.length ?? 1;
  const unit = 124; // px per first-round matchup slot (box height + gap)
  return (
    <div>
      {/* Desktop tree */}
      <div className="hidden overflow-x-auto pb-4 md:block" role="region" aria-label={`${b.name} bracket diagram`} tabIndex={0}>
        <div className="flex gap-10" style={{ minHeight: firstCount * unit }}>
          {rounds.map((r, ri) => (
            <div key={r.round} className="flex shrink-0 flex-col">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-muted">{r.name}</h3>
              <ol className="flex flex-1 flex-col justify-around">
                {r.matchups.map((m) => (
                  <li key={m.id} className="relative flex items-center" style={{ height: unit * 2 ** ri }}>
                    <MatchupBox m={m} />
                    {ri < rounds.length - 1 && <span aria-hidden className="absolute -right-10 top-1/2 h-px w-10 bg-line-strong" />}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>
      {/* Mobile list */}
      <div className="space-y-6 md:hidden">
        {rounds.map((r) => (
          <section key={r.round} aria-labelledby={`r-${b.id}-${r.round}`}>
            <h3 id={`r-${b.id}-${r.round}`} className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-muted">
              {r.name}
            </h3>
            <ol className="space-y-2">
              {r.matchups.map((m) => (
                <li key={m.id}>
                  <MatchupBox m={m} />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
