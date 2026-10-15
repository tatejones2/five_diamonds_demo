import type { Paginated, PublicTournamentSummary } from '@fd/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarCheck, ClipboardList, Radio, ShieldCheck, Trophy } from 'lucide-react';
import { Link } from 'react-router';
import { Markdown } from '../../components/Markdown';
import { TournamentCard } from '../../components/TournamentCard';
import { EmptyState, ErrorState, LinkButton, SectionTitle, SkeletonList } from '../../components/ui';
import { api } from '../../lib/api';
import { formatCalendarDate } from '../../lib/format';
import { useSeo } from '../../lib/seo';

interface PageContent {
  published: boolean;
  title: string | null;
  body: string | null;
}

export default function Home() {
  useSeo({ description: 'Find and enter youth baseball tournaments in the North Carolina Triad. Schedules, scores, brackets and game-day updates.' });
  const upcoming = useQuery({ queryKey: ['tournaments', 'home'], queryFn: () => api<Paginated<PublicTournamentSummary>>('/tournaments?when=upcoming&pageSize=4') });
  const intro = useQuery({ queryKey: ['content', 'home_intro'], queryFn: () => api<PageContent>('/content/pages?key=home_intro') });
  const news = useQuery({ queryKey: ['news'], queryFn: () => api<{ slug: string; title: string; excerpt: string | null; publishedAt: string | null; isDemo: boolean }[]>('/content/news') });
  const sponsors = useQuery({ queryKey: ['sponsors'], queryFn: () => api<{ id: string; name: string; websiteUrl: string | null }[]>('/content/sponsors') });

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-brand-navy text-white">
        <div className="diamond-grid absolute inset-0 opacity-70" aria-hidden />
        <div aria-hidden className="absolute -right-24 -top-24 size-[28rem] rotate-45 rounded-[3rem] border-[28px] border-white/5" />
        <div aria-hidden className="absolute -bottom-40 right-40 size-80 rotate-45 rounded-[2rem] bg-brand-flame/20 blur-2xl" />
        <div className="container-page relative py-16 sm:py-24">
          <p className="eyebrow !text-white/75">North Carolina Triad · Youth Baseball</p>
          <h1 className="mt-3 max-w-3xl text-5xl font-bold uppercase leading-[0.95] sm:text-7xl">
            {intro.data?.published ? intro.data.title : 'Tournament baseball, run right.'}
          </h1>
          <div className="mt-5 max-w-xl text-lg text-white/80">
            {intro.data?.published ? <Markdown className="!text-white/80 [&_p]:my-0">{intro.data.body}</Markdown> : <p>Weekend tournaments across the Triad. Clear schedules, live scores and brackets, and updates the moment plans change.</p>}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton to="/tournaments" variant="flame" size="lg">
              Find a Tournament <ArrowRight className="size-5" aria-hidden />
            </LinkButton>
            <LinkButton to="/game-day" size="lg" className="!bg-white/10 !text-white ring-1 ring-white/30 hover:!bg-white/20">
              <Radio className="size-5" aria-hidden /> This Weekend
            </LinkButton>
          </div>
        </div>
      </section>

      {/* Upcoming */}
      <section className="container-page py-14" aria-labelledby="upcoming-heading">
        <SectionTitle
          id="upcoming-heading"
          action={
            <Link to="/tournaments" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-navy hover:underline">
              All tournaments <ArrowRight className="size-4" aria-hidden />
            </Link>
          }
        >
          Upcoming Tournaments
        </SectionTitle>
        {upcoming.isPending ? (
          <SkeletonList rows={3} />
        ) : upcoming.isError ? (
          <ErrorState error={upcoming.error} retry={() => upcoming.refetch()} />
        ) : upcoming.data.items.length === 0 ? (
          <EmptyState icon={<CalendarCheck className="size-6" />} title="New events coming soon">
            The next season's schedule hasn't been announced yet. Check back soon or contact us to get on the list.
          </EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {upcoming.data.items.map((t) => (
              <TournamentCard key={t.id} t={t} />
            ))}
          </div>
        )}
      </section>

      {/* Why */}
      <section className="border-y border-line bg-surface" aria-labelledby="why-heading">
        <div className="container-page py-14">
          <SectionTitle id="why-heading">Why coaches choose 5 Diamonds</SectionTitle>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { Icon: ClipboardList, h: 'Register in minutes', p: 'One account for all your teams. Enter divisions, manage rosters and track status in one place.' },
              { Icon: CalendarCheck, h: 'Schedules you can trust', p: 'Published schedules with field, time and change history, readable on any phone.' },
              { Icon: Trophy, h: 'Live brackets & scores', p: 'Scores and bracket advancement update as directors finalize games.' },
              { Icon: ShieldCheck, h: 'Rosters stay private', p: "Player names are never public. Only you and authorized tournament staff can see your roster." },
            ].map(({ Icon, h, p }) => (
              <li key={h}>
                <div className="flex size-11 items-center justify-center rounded-xl bg-brand-sky-soft text-brand-navy">
                  <Icon className="size-5" aria-hidden />
                </div>
                <h3 className="mt-4 text-lg font-semibold uppercase">{h}</h3>
                <p className="mt-1.5 text-sm text-ink-muted">{p}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Facilities + News */}
      <section className="container-page grid gap-10 py-14 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <SectionTitle>Ballparks</SectionTitle>
          <div className="card overflow-hidden">
            <div className="relative h-40 bg-brand-navy-deep">
              <div className="diamond-grid absolute inset-0" aria-hidden />
              <svg viewBox="0 0 200 120" className="absolute inset-0 m-auto h-28 text-white/25" aria-hidden>
                <path d="M100 110 30 40a99 99 0 0 1 140 0Z" fill="currentColor" />
                <path d="M100 100 70 70 100 40 130 70Z" fill="none" stroke="#fff" strokeWidth="2" opacity=".7" />
              </svg>
            </div>
            <div className="p-5">
              <p className="text-sm text-ink-muted">Addresses, field maps, parking and facility policies for every venue we use.</p>
              <LinkButton to="/facilities" variant="secondary" size="sm" className="mt-4">
                View facilities
              </LinkButton>
            </div>
          </div>
        </div>
        <div className="lg:col-span-3">
          <SectionTitle action={<Link to="/news" className="text-sm font-semibold text-brand-navy hover:underline">All news</Link>}>News & Announcements</SectionTitle>
          {news.isPending ? (
            <SkeletonList rows={2} />
          ) : news.isError ? (
            <ErrorState error={news.error} retry={() => news.refetch()} />
          ) : news.data.length === 0 ? (
            <EmptyState title="No news yet">Announcements will appear here.</EmptyState>
          ) : (
            <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
              {news.data.slice(0, 4).map((n) => (
                <li key={n.slug} className="p-4 sm:p-5">
                  {n.publishedAt && <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">{formatCalendarDate(n.publishedAt.slice(0, 10))}</p>}
                  <Link to={`/news/${n.slug}`} className="mt-1 block font-semibold text-ink hover:text-brand-navy hover:underline">
                    {n.title}
                  </Link>
                  {n.excerpt && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{n.excerpt}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Sponsors: only owner-approved, published partners appear */}
      {sponsors.data && sponsors.data.length > 0 && (
        <section className="border-t border-line bg-surface" aria-labelledby="sponsor-heading">
          <div className="container-page py-10">
            <h2 id="sponsor-heading" className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-ink-subtle">
              Our Partners
            </h2>
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
              {sponsors.data.map((s) => (
                <li key={s.id} className="font-display text-lg font-semibold uppercase text-ink-muted">
                  {s.websiteUrl ? (
                    <a href={s.websiteUrl} target="_blank" rel="noopener noreferrer" className="hover:text-brand-navy">
                      {s.name}
                    </a>
                  ) : (
                    s.name
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
