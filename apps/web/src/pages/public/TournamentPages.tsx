import type { PublicAnnouncement, PublicBracket, PublicGame, PublicSchedule, PublicStandingsDivision, PublicTeamRef, PublicTournamentDetail } from '@fd/shared';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ClipboardList, ExternalLink, MapPin, RefreshCw, Trophy, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useOutletContext, useParams, useSearchParams } from 'react-router';
import { AlertBanner } from '../../components/alerts';
import { BracketView } from '../../components/Bracket';
import { GameCard } from '../../components/GameCard';
import { Markdown } from '../../components/Markdown';
import { StandingsPool } from '../../components/Standings';
import { TournamentBadges } from '../../components/status';
import { Badge, Button, Card, cx, DemoTag, EmptyState, ErrorState, LinkButton, SectionTitle, SelectField, Skeleton, SkeletonList } from '../../components/ui';
import { api } from '../../lib/api';
import { easternDateKey, formatDateRange, formatEasternLongDay, formatEasternStamp, relativeTime } from '../../lib/format';
import { useSeo } from '../../lib/seo';

const POLL = 30_000;

export function useTournament(slug: string) {
  return useQuery({ queryKey: ['tournament', slug], queryFn: () => api<PublicTournamentDetail>(`/tournaments/${slug}`), refetchInterval: 60_000 });
}

const tabs = [
  { to: '', label: 'Overview', end: true },
  { to: 'schedule', label: 'Schedule' },
  { to: 'scores', label: 'Scores' },
  { to: 'brackets', label: 'Brackets' },
  { to: 'standings', label: 'Standings' },
  { to: 'teams', label: 'Teams' },
  { to: 'updates', label: 'Updates' },
];

export function TournamentLayout() {
  const { slug = '' } = useParams();
  const t = useTournament(slug);
  useSeo({ title: t.data?.title, description: t.data?.summary ?? undefined });

  if (t.isPending)
    return (
      <div className="container-page py-10">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="mt-4 h-6 w-1/3" />
        <SkeletonList rows={3} />
      </div>
    );
  if (t.isError)
    return (
      <div className="container-page py-10">
        <ErrorState error={t.error} retry={() => t.refetch()} />
      </div>
    );
  const d = t.data;
  return (
    <>
      <section className="relative overflow-hidden bg-brand-navy text-white">
        <div className="diamond-grid absolute inset-0 opacity-60" aria-hidden />
        <div className="container-page relative py-6 sm:py-12">
          <nav aria-label="Breadcrumb" className="text-sm text-white/70">
            <Link to="/tournaments" className="hover:text-white hover:underline">
              Tournaments
            </Link>{' '}
            / <span aria-current="page">{d.title}</span>
          </nav>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TournamentBadges {...d} waitlist={d.divisions.some((x) => x.waitlistAvailable)} />
            {d.isDemo && <DemoTag className="!border-white/60 !text-white" />}
          </div>
          <h1 className="mt-2 text-3xl font-bold uppercase leading-tight sm:mt-3 sm:text-5xl">{d.title}</h1>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-white/85 sm:mt-3 sm:text-base">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" aria-hidden /> {formatDateRange(d.startsOn, d.endsOn)}
            </span>
            {(d.venues.length > 0 || d.region) && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4" aria-hidden /> {d.venues.map((v) => v.name).join(' · ') || d.region}
              </span>
            )}
            {d.ageLabels.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-4" aria-hidden /> {d.ageLabels.join(' · ')}
              </span>
            )}
          </div>
          {d.registrationState === 'open' && (
            <div className="mt-6">
              <LinkButton to={`/tournaments/${d.slug}/register`} variant="flame" size="lg">
                <ClipboardList className="size-5" aria-hidden /> Register a Team
              </LinkButton>
            </div>
          )}
        </div>
      </section>
      <div className="sticky top-16 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <nav aria-label="Tournament sections" className="container-page -mb-px flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <NavLink key={tab.label} to={tab.to} end={tab.end} className={({ isActive }) => cx('whitespace-nowrap border-b-2 px-3 py-3.5 text-sm font-semibold', isActive ? 'border-brand-flame text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="container-page py-8">
        {d.activeAlerts.length > 0 && (
          <div className="mb-6 space-y-2">
            {d.activeAlerts.map((a) => (
              <AlertBanner key={a.id} a={a} />
            ))}
          </div>
        )}
        <Outlet context={d} />
      </div>
    </>
  );
}

const useT = () => useOutletContext<PublicTournamentDetail>();

export function TournamentOverview() {
  const t = useT();
  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="space-y-8 lg:col-span-2">
        {t.description && (
          <section>
            <SectionTitle>About this event</SectionTitle>
            <Markdown>{t.description}</Markdown>
          </section>
        )}
        <section aria-labelledby="divisions-h">
          <SectionTitle id="divisions-h">Divisions</SectionTitle>
          {t.divisions.length === 0 ? (
            <EmptyState title="Divisions coming soon" />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {t.divisions.map((d) => (
                <li key={d.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-display text-xl font-semibold uppercase">{d.name}</h3>
                      <p className="text-sm text-ink-muted">
                        {d.ageLabel}
                        {d.classification ? ` · ${d.classification}` : ''}
                      </p>
                    </div>
                    {d.spotsRemaining !== null &&
                      (d.isFull ? (
                        <Badge tone={d.waitlistAvailable ? 'warn' : 'danger'}>{d.waitlistAvailable ? 'Waitlist' : 'Full'}</Badge>
                      ) : (
                        <Badge tone="ok">
                          {d.spotsRemaining} of {d.capacity} spots left
                        </Badge>
                      ))}
                  </div>
                  {d.gameFormat && <p className="mt-3 text-sm text-ink-muted">{d.gameFormat}</p>}
                  {d.rulesText && (
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer font-semibold text-brand-navy">Division rules</summary>
                      <Markdown className="mt-2 text-sm">{d.rulesText}</Markdown>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        {t.rulesText && (
          <section>
            <SectionTitle>Event rules</SectionTitle>
            <Card className="p-5">
              <Markdown>{t.rulesText}</Markdown>
            </Card>
          </section>
        )}
      </div>
      <aside className="space-y-4">
        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold uppercase">Key details</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <Detail label="Dates">{formatDateRange(t.startsOn, t.endsOn)}</Detail>
            {t.registrationOpensAt && <Detail label="Registration opens">{formatEasternStamp(t.registrationOpensAt)}</Detail>}
            {t.registrationClosesAt && <Detail label="Registration closes">{formatEasternStamp(t.registrationClosesAt)}</Detail>}
            {t.rosterLocksAt && <Detail label="Roster deadline">{formatEasternStamp(t.rosterLocksAt)}</Detail>}
            {t.feeInfo && <Detail label="Fees">{t.feeInfo}</Detail>}
            {t.refundPolicyUrl && (
              <Detail label="Refunds & withdrawals">
                <a href={t.refundPolicyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-navy underline">
                  Policy <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </Detail>
            )}
            {t.operationalContacts && <Detail label="Event contact">{t.operationalContacts}</Detail>}
          </dl>
        </Card>
        {t.venues.length > 0 && (
          <Card className="p-5">
            <h2 className="font-display text-lg font-semibold uppercase">Venues</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {t.venues.map((v) => (
                <li key={v.id}>
                  <Link to={`/facilities/${v.slug}`} className="font-semibold text-brand-navy hover:underline">
                    {v.name}
                  </Link>
                  {v.city && (
                    <span className="text-ink-muted">
                      {' '}
                      · {v.city}
                      {v.state ? `, ${v.state}` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
        <div className="grid grid-cols-2 gap-2">
          <LinkButton to="schedule" variant="secondary">
            <CalendarDays className="size-4" aria-hidden /> Schedule
          </LinkButton>
          <LinkButton to="brackets" variant="secondary">
            <Trophy className="size-4" aria-hidden /> Brackets
          </LinkButton>
        </div>
      </aside>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

// ---- Schedule / scores -------------------------------------------------------------------------

function useSchedule(slug: string) {
  return useQuery({ queryKey: ['schedule', slug], queryFn: () => api<PublicSchedule>(`/tournaments/${slug}/games`), refetchInterval: POLL, refetchOnWindowFocus: true });
}

function UpdatedLine({ at, fetching, refetch, publishedAt }: { at: number; fetching: boolean; refetch: () => void; publishedAt: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-subtle">
      {publishedAt && <span>Schedule published {formatEasternStamp(publishedAt)}</span>}
      <span aria-live="polite">Checked {relativeTime(new Date(at).toISOString())}</span>
      <button type="button" onClick={refetch} className="inline-flex items-center gap-1 font-semibold text-brand-navy hover:underline" disabled={fetching}>
        <RefreshCw className={cx('size-3.5', fetching && 'animate-spin')} aria-hidden /> Refresh
      </button>
    </div>
  );
}

export function TournamentSchedule({ scoresOnly }: { scoresOnly?: boolean }) {
  const t = useT();
  const s = useSchedule(t.slug);
  const [params, setParams] = useSearchParams();
  const division = params.get('division') ?? '';
  const team = params.get('team') ?? '';
  const field = params.get('field') ?? '';
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  const affected = new Set(t.activeAlerts.flatMap((a) => a.affectedGameIds));

  const all = s.data?.games ?? [];
  const teams = useMemo(() => {
    const m = new Map<string, PublicTeamRef>();
    for (const g of all) for (const x of [g.home, g.away]) if (x) m.set(x.id, x);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);
  const fieldsList = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of all) if (g.field) m.set(g.field.id, `${g.field.venueName} · ${g.field.name}`);
    return [...m.entries()];
  }, [all]);
  let games = all.filter((g) => (!division || g.divisionId === division) && (!team || g.home?.id === team || g.away?.id === team) && (!field || g.field?.id === field));
  if (scoresOnly) games = games.filter((g) => g.status === 'final' || g.status === 'in_progress' || g.status === 'suspended').reverse();
  const days = [...new Set(games.map((g) => (g.startsAt ? easternDateKey(g.startsAt) : 'tbd')))];
  const [day, setDay] = useState<string | null>(null);
  const today = easternDateKey(new Date());
  const activeDay = day ?? (days.includes(today) ? today : days[0]) ?? null;
  const visible = scoresOnly ? games : games.filter((g) => (g.startsAt ? easternDateKey(g.startsAt) : 'tbd') === activeDay);

  if (s.isPending) return <SkeletonList rows={4} />;
  if (s.isError) return <ErrorState error={s.error} retry={() => s.refetch()} />;
  if (!s.data.publishedAt && all.length === 0) {
    return (
      <EmptyState icon={<CalendarDays className="size-6" />} title="Schedule not announced yet">
        The tournament director hasn't published game times. Check back closer to the event{t.registrationState === 'open' ? ', or register your team now' : ''}.
      </EmptyState>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SectionTitle>{scoresOnly ? 'Scores & Results' : 'Schedule'}</SectionTitle>
        <UpdatedLine at={s.dataUpdatedAt} fetching={s.isFetching} refetch={() => s.refetch()} publishedAt={s.data.publishedAt} />
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <SelectField label="Division" value={division} onChange={(e) => set('division', e.target.value)}>
          <option value="">All divisions</option>
          {t.divisions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Team" value={team} onChange={(e) => set('team', e.target.value)}>
          <option value="">All teams</option>
          {teams.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Field" value={field} onChange={(e) => set('field', e.target.value)}>
          <option value="">All fields</option>
          {fieldsList.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </SelectField>
      </div>
      {!scoresOnly && days.length > 1 && (
        <div role="tablist" aria-label="Day" className="mb-5 flex gap-2 overflow-x-auto">
          {days.map((d) => (
            <button key={d} role="tab" type="button" aria-selected={d === activeDay} onClick={() => setDay(d)} className={cx('whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold', d === activeDay ? 'bg-brand-navy text-white' : 'bg-surface text-ink-muted ring-1 ring-line hover:text-ink')}>
              {d === 'tbd' ? 'Time TBD' : formatEasternLongDay(`${d}T16:00:00Z`).replace(/, \d{4}$/, '')}
            </button>
          ))}
        </div>
      )}
      {visible.length === 0 ? (
        <EmptyState title={scoresOnly ? 'No results yet' : 'No games match these filters'}>{scoresOnly ? 'Scores appear here as staff finalize games.' : 'Try clearing a filter.'}</EmptyState>
      ) : (
        <>
          {!scoresOnly && activeDay && activeDay !== 'tbd' && <h3 className="mb-3 font-display text-lg font-semibold uppercase text-ink-muted">{formatEasternLongDay(`${activeDay}T16:00:00Z`)}</h3>}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((g: PublicGame) => (
              <li key={g.id}>
                <GameCard g={g} highlightTeamId={team || undefined} affected={affected.has(g.id)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export const TournamentScores = () => <TournamentSchedule scoresOnly />;

export function TournamentBrackets() {
  const t = useT();
  const q = useQuery({ queryKey: ['brackets', t.slug], queryFn: () => api<PublicBracket[]>(`/tournaments/${t.slug}/brackets`), refetchInterval: POLL });
  if (q.isPending) return <SkeletonList rows={2} />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (q.data.length === 0)
    return (
      <EmptyState icon={<Trophy className="size-6" />} title="Brackets not published yet">
        Playoff brackets appear here once seeding is set by the tournament director.
      </EmptyState>
    );
  return (
    <div className="space-y-10">
      {q.data.map((b) => (
        <section key={b.id} aria-labelledby={`b-${b.id}`}>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="eyebrow">{b.divisionName}</p>
              <h2 id={`b-${b.id}`} className="text-2xl font-semibold uppercase">
                {b.name}
              </h2>
            </div>
            <p className="text-xs text-ink-subtle">Updated {formatEasternStamp(b.updatedAt)}</p>
          </div>
          <BracketView b={b} />
        </section>
      ))}
    </div>
  );
}

export function TournamentStandings() {
  const t = useT();
  const q = useQuery({ queryKey: ['standings', t.slug], queryFn: () => api<PublicStandingsDivision[]>(`/tournaments/${t.slug}/standings`), refetchInterval: POLL });
  if (q.isPending) return <SkeletonList rows={2} />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (q.data.length === 0) return <EmptyState title="No pool play results yet">Standings are calculated from final pool-play games.</EmptyState>;
  return (
    <div className="space-y-10">
      {q.data.map((d) => (
        <section key={d.divisionId}>
          <SectionTitle>{d.divisionName}</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-2">
            {d.pools.map((p) => (
              <StandingsPool key={p.poolLabel ?? 'all'} pool={p} divisionName={d.divisionName} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function TournamentTeams() {
  const t = useT();
  const q = useQuery({ queryKey: ['teams', t.slug], queryFn: () => api<{ visible: boolean; divisions: { id: string; name: string; teams: PublicTeamRef[]; confirmedCount: number }[] }>(`/tournaments/${t.slug}/teams`) });
  if (q.isPending) return <SkeletonList rows={2} />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data.visible) return <EmptyState title="Team list not public">The organizers have chosen not to publish registered team names for this event.</EmptyState>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {q.data.divisions.map((d) => (
        <Card key={d.id} className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold uppercase">{d.name}</h2>
            <Badge>{d.confirmedCount} confirmed</Badge>
          </div>
          {d.teams.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">No confirmed teams yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {d.teams.map((x) => (
                <li key={x.id} className="flex justify-between py-2 text-sm">
                  <span className="font-semibold text-ink">{x.name}</span>
                  {x.city && (
                    <span className="text-ink-muted">
                      {x.city}
                      {x.state ? `, ${x.state}` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-subtle">Rosters are private and never shown publicly.</p>
        </Card>
      ))}
    </div>
  );
}

export function TournamentUpdates() {
  const t = useT();
  const q = useQuery({ queryKey: ['announcements', t.slug], queryFn: () => api<{ active: PublicAnnouncement[]; history: PublicAnnouncement[] }>(`/tournaments/${t.slug}/announcements`), refetchInterval: POLL });
  if (q.isPending) return <SkeletonList rows={2} />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (q.data.history.length === 0) return <EmptyState title="No updates">Weather delays, field changes and other notices will be posted here.</EmptyState>;
  return (
    <div className="max-w-3xl">
      <SectionTitle>Updates & notices</SectionTitle>
      <ol className="relative space-y-4 border-l-2 border-line pl-6">
        {q.data.history.map((a) => (
          <li key={a.id} className="relative">
            <span className={cx('absolute -left-[33px] top-4 size-4 rounded-full border-2 border-surface', a.status === 'all_clear' ? 'bg-ok' : a.severity === 'critical' ? 'bg-danger' : a.severity === 'advisory' ? 'bg-warn' : 'bg-info')} aria-hidden />
            <AlertBanner a={a} />
            {a.status === 'all_clear' && (
              <div className="mt-2 rounded-lg border border-ok/30 bg-ok-soft px-4 py-2 text-sm text-ink">
                <span className="font-semibold text-ok">All clear:</span> {a.allClearMessage}
              </div>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-6 text-xs text-ink-subtle">Times are Eastern. This page refreshes automatically every 30 seconds.</p>
      <Button variant="ghost" size="sm" onClick={() => q.refetch()} className="mt-2">
        <RefreshCw className="size-4" aria-hidden /> Refresh now
      </Button>
    </div>
  );
}
