import type { PublicTournamentSummary } from '@fd/shared';
import { CalendarDays, ChevronRight, MapPin, Users } from 'lucide-react';
import { Link } from 'react-router';
import { formatDateRange, formatEasternStamp } from '../lib/format';
import { TournamentBadges } from './status';
import { DemoTag } from './ui';

export function TournamentCard({ t }: { t: PublicTournamentSummary }) {
  const [, month, day] = t.startsOn.split('-');
  const monthLabel = new Date(Date.UTC(2000, Number(month) - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return (
    <article className="card group relative flex gap-4 p-4 transition hover:shadow-[var(--shadow-lift)] sm:p-5">
      <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-brand-navy py-2 text-white" aria-hidden>
        <span className="text-[11px] font-semibold uppercase tracking-widest text-white/75">{monthLabel}</span>
        <span className="font-display text-3xl font-bold leading-none">{Number(day)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <TournamentBadges {...t} />
          {t.isDemo && <DemoTag />}
        </div>
        <h3 className="mt-2 text-lg font-semibold uppercase leading-snug text-ink sm:text-xl">
          <Link to={`/tournaments/${t.slug}`} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {t.title}
          </Link>
        </h3>
        <dl className="mt-2 grid gap-1 text-sm text-ink-muted sm:grid-cols-2">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Dates</dt>
            <CalendarDays className="size-4 shrink-0 text-ink-subtle" aria-hidden />
            <dd>{formatDateRange(t.startsOn, t.endsOn)}</dd>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <dt className="sr-only">Location</dt>
            <MapPin className="size-4 shrink-0 text-ink-subtle" aria-hidden />
            <dd className="truncate">{t.venues.length ? t.venues.map((v) => v.name).join(', ') : (t.region ?? 'Location TBA')}</dd>
          </div>
          {t.ageLabels.length > 0 && (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Divisions</dt>
              <Users className="size-4 shrink-0 text-ink-subtle" aria-hidden />
              <dd>{t.ageLabels.join(' · ')}</dd>
            </div>
          )}
          {t.registrationState === 'open' && t.registrationClosesAt && (
            <div className="flex items-center gap-1.5 sm:col-span-2">
              <dt className="font-medium text-ink">Register by</dt>
              <dd>{formatEasternStamp(t.registrationClosesAt)}</dd>
            </div>
          )}
          {t.feeInfo && (
            <div className="flex items-center gap-1.5 sm:col-span-2">
              <dt className="font-medium text-ink">Fee</dt>
              <dd>{t.feeInfo}</dd>
            </div>
          )}
        </dl>
      </div>
      <ChevronRight className="hidden size-5 self-center text-ink-subtle transition group-hover:translate-x-0.5 sm:block" aria-hidden />
    </article>
  );
}
