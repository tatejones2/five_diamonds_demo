import type { Paginated, PublicTournamentSummary } from '@fd/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, List, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { TournamentCard } from '../../components/TournamentCard';
import { Button, cx, EmptyState, ErrorState, PageHeader, SelectField, SkeletonList, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useSeo } from '../../lib/seo';

const AGE_OPTIONS = ['6U', '7U', '8U', '9U', '10U', '11U', '12U', '13U', '14U', '15U', '16U', '17U', '18U'];

export default function Tournaments() {
  useSeo({ title: 'Tournaments', description: 'Search upcoming and past 5 Diamonds youth baseball tournaments by date, age group and facility.' });
  const [params, setParams] = useSearchParams();
  const when = (params.get('when') ?? 'upcoming') as 'upcoming' | 'past' | 'all';
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list';
  const page = Number(params.get('page') ?? 1);
  const [q, setQ] = useState(params.get('q') ?? '');

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const qs = new URLSearchParams({ when, page: String(page), pageSize: view === 'calendar' ? '100' : '12' });
  for (const k of ['q', 'ageLabel', 'venue', 'availability']) {
    const v = params.get(k);
    if (v) qs.set(k, v);
  }
  const list = useQuery({ queryKey: ['tournaments', qs.toString()], queryFn: () => api<Paginated<PublicTournamentSummary>>(`/tournaments?${qs}`), placeholderData: keepPreviousData });
  const venues = useQuery({ queryKey: ['facilities'], queryFn: () => api<{ slug: string; name: string }[]>('/facilities') });
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="container-page py-10">
      <PageHeader eyebrow="Find a Tournament" title="Tournaments" description="Search by date, age group and ballpark. Times shown in Eastern." />

      <form
        role="search"
        className="card mb-6 grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          set('q', q.trim() || null);
        }}
      >
        <TextField label="Search" placeholder="Tournament name" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
        <SelectField label="Age group" value={params.get('ageLabel') ?? ''} onChange={(e) => set('ageLabel', e.target.value || null)}>
          <option value="">All ages</option>
          {AGE_OPTIONS.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </SelectField>
        <SelectField label="Facility" value={params.get('venue') ?? ''} onChange={(e) => set('venue', e.target.value || null)}>
          <option value="">All facilities</option>
          {venues.data?.map((v) => (
            <option key={v.slug} value={v.slug}>
              {v.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Availability" value={params.get('availability') ?? 'any'} onChange={(e) => set('availability', e.target.value === 'any' ? null : e.target.value)}>
          <option value="any">Any</option>
          <option value="open">Open spots</option>
          <option value="full">Full / waitlist</option>
        </SelectField>
        <Button type="submit">
          <Search className="size-4" aria-hidden /> Search
        </Button>
      </form>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Time range" className="inline-flex rounded-lg border border-line bg-surface p-1">
          {(['upcoming', 'past', 'all'] as const).map((w) => (
            <button key={w} role="tab" aria-selected={when === w} type="button" onClick={() => set('when', w === 'upcoming' ? null : w)} className={cx('rounded-md px-3.5 py-1.5 text-sm font-semibold capitalize', when === w ? 'bg-brand-navy text-white' : 'text-ink-muted hover:text-ink')}>
              {w}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface p-1" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'list'} onClick={() => set('view', null)} className={cx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold', view === 'list' ? 'bg-surface-sunk text-ink' : 'text-ink-muted')}>
            <List className="size-4" aria-hidden /> List
          </button>
          <button type="button" aria-pressed={view === 'calendar'} onClick={() => set('view', 'calendar')} className={cx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold', view === 'calendar' ? 'bg-surface-sunk text-ink' : 'text-ink-muted')}>
            <CalendarDays className="size-4" aria-hidden /> Calendar
          </button>
        </div>
      </div>

      <div aria-live="polite" className="sr-only">
        {list.data ? `${list.data.total} tournaments found` : ''}
      </div>

      {list.isPending ? (
        <SkeletonList rows={4} />
      ) : list.isError ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={<CalendarDays className="size-6" />} title="No tournaments match">
          Try a different age group or facility, or look at past events.
        </EmptyState>
      ) : view === 'calendar' ? (
        <CalendarView items={list.data.items} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {list.data.items.map((t) => (
              <TournamentCard key={t.id} t={t} />
            ))}
          </div>
          {totalPages > 1 && (
            <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-3">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>
                <ChevronLeft className="size-4" aria-hidden /> Previous
              </Button>
              <span className="text-sm text-ink-muted">
                Page {page} of {totalPages}
              </span>
              <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => set('page', String(page + 1))}>
                Next <ChevronRight className="size-4" aria-hidden />
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function CalendarView({ items }: { items: PublicTournamentSummary[] }) {
  const first = items[0]?.startsOn ?? new Date().toISOString().slice(0, 10);
  const [cursor, setCursor] = useState(() => ({ y: Number(first.slice(0, 4)), m: Number(first.slice(5, 7)) - 1 }));
  const days = useMemo(() => {
    const start = new Date(Date.UTC(cursor.y, cursor.m, 1));
    const offset = start.getUTCDay();
    const count = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
    return { offset, count };
  }, [cursor]);
  const key = (d: number) => `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const on = (d: number) => items.filter((t) => t.startsOn <= key(d) && t.endsOn >= key(d));
  const label = new Date(Date.UTC(cursor.y, cursor.m, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const move = (n: number) => setCursor((c) => ({ y: c.y + Math.floor((c.m + n) / 12), m: (((c.m + n) % 12) + 12) % 12 }));
  const monthEvents = items.filter((t) => t.startsOn.slice(0, 7) <= key(1).slice(0, 7) && t.endsOn.slice(0, 7) >= key(1).slice(0, 7));

  return (
    <div className="card p-4">
      <div className="mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => move(-1)} aria-label="Previous month">
          <ChevronLeft className="size-5" />
        </Button>
        <h2 className="text-xl font-semibold uppercase" aria-live="polite">
          {label}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => move(1)} aria-label="Next month">
          <ChevronRight className="size-5" />
        </Button>
      </div>
      {/* Grid for wide screens; the list below is the accessible equivalent and the mobile view. */}
      <div className="hidden grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid" aria-hidden>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="bg-surface-alt py-2 text-center text-xs font-semibold uppercase text-ink-muted">
            {d}
          </div>
        ))}
        {Array.from({ length: days.offset }, (_, i) => (
          <div key={`e${i}`} className="min-h-24 bg-surface-alt/50" />
        ))}
        {Array.from({ length: days.count }, (_, i) => (
          <div key={i} className="min-h-24 bg-surface p-1.5">
            <div className="tabular text-xs font-semibold text-ink-subtle">{i + 1}</div>
            {on(i + 1).map((t) => (
              <Link key={t.id} to={`/tournaments/${t.slug}`} tabIndex={-1} className="mt-1 block truncate rounded bg-brand-navy px-1.5 py-0.5 text-[11px] font-semibold text-white">
                {t.title}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <ul className="mt-4 space-y-2 md:sr-only">
        {monthEvents.length === 0 && <li className="text-sm text-ink-muted">No tournaments this month.</li>}
        {monthEvents.map((t) => (
          <li key={t.id}>
            <Link to={`/tournaments/${t.slug}`} className="font-semibold text-brand-navy underline">
              {t.title}
            </Link>{' '}
            <span className="text-sm text-ink-muted">
              {t.startsOn} – {t.endsOn}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
