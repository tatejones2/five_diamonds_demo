import type { PublicGame } from '@fd/shared';
import { MapPin } from 'lucide-react';
import { formatEasternTime } from '../lib/format';
import { GameStatusBadge } from './status';
import { cx } from './ui';

function Side({ name, placeholder, score, isWinner, showScore }: { name?: string | null; placeholder?: string | null; score: number | null; isWinner: boolean; showScore: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={cx('min-w-0 truncate text-[15px]', name ? 'font-semibold text-ink' : 'italic text-ink-subtle', isWinner && 'text-brand-navy')}>
        {name ?? placeholder ?? 'TBD'}
        {isWinner && <span className="sr-only"> (winner)</span>}
      </span>
      {showScore && <span className={cx('tabular font-display text-xl font-semibold', isWinner ? 'text-brand-navy' : 'text-ink-muted')}>{score ?? '–'}</span>}
    </div>
  );
}

/** Mobile-first game card: time, field, teams, status and score — no horizontal scrolling. */
export function GameCard({ g, highlightTeamId, affected }: { g: PublicGame; highlightTeamId?: string; affected?: boolean }) {
  const showScore = g.status === 'final' || g.status === 'in_progress' || g.status === 'suspended' || g.homeScore !== null;
  const forfeit = g.status === 'final' && g.resultType === 'forfeit';
  const involves = highlightTeamId && (g.home?.id === highlightTeamId || g.away?.id === highlightTeamId);
  return (
    <article className={cx('card flex flex-col gap-3 p-4', involves && 'ring-2 ring-brand-sky', affected && 'border-warn')} aria-label={`${g.away?.name ?? g.awayPlaceholder ?? 'TBD'} at ${g.home?.name ?? g.homePlaceholder ?? 'TBD'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tabular font-display text-lg font-semibold leading-none text-ink">{g.startsAt ? formatEasternTime(g.startsAt) : 'Time TBD'}</p>
          <p className="mt-1 flex items-center gap-1 truncate text-xs text-ink-muted">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            {g.field ? `${g.field.venueName} · ${g.field.name}` : 'Field TBD'}
          </p>
        </div>
        <GameStatusBadge status={g.status} forfeit={forfeit} />
      </div>
      <div className="space-y-1.5 border-t border-line pt-3">
        <Side name={g.away?.name} placeholder={g.awayPlaceholder} score={g.awayScore} isWinner={g.winner === 'away'} showScore={showScore && !forfeit} />
        <Side name={g.home?.name} placeholder={g.homePlaceholder} score={g.homeScore} isWinner={g.winner === 'home'} showScore={showScore && !forfeit} />
      </div>
      <p className="text-xs text-ink-subtle">
        {g.divisionName}
        {g.bracketRoundName ? ` · ${g.bracketRoundName}` : g.poolLabel ? ` · Pool ${g.poolLabel}` : ''}
        {g.label && !g.bracketRoundName ? ` · ${g.label}` : ''}
        <span className="sr-only">. Home team listed second.</span>
      </p>
    </article>
  );
}
