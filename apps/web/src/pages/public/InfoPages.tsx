import type { PublicAnnouncement, PublicTournamentSummary } from '@fd/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarDays, ExternalLink, Lightbulb, Mail, MapPin, Phone, Radio } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { AlertBanner } from '../../components/alerts';
import { Markdown } from '../../components/Markdown';
import { TournamentBadges } from '../../components/status';
import { Alert, Button, Card, DemoTag, EmptyState, ErrorState, FormError, LinkButton, PageHeader, SelectField, SkeletonList, TextArea, TextField } from '../../components/ui';
import { api, ApiRequestError } from '../../lib/api';
import { formatCalendarDate, formatDateRange, formatEasternStamp } from '../../lib/format';
import { useSeo } from '../../lib/seo';

// ---- Game day ------------------------------------------------------------------------------------

type GameDayItem = PublicTournamentSummary & { isToday: boolean; publishedGameCount: number; activeAlerts: PublicAnnouncement[] };

export function GameDay() {
  useSeo({ title: 'Game Day', description: "Today's and this week's tournaments: schedules, scores, brackets and weather updates." });
  const q = useQuery({ queryKey: ['game-day'], queryFn: () => api<GameDayItem[]>('/game-day'), refetchInterval: 30_000 });
  return (
    <div className="container-page py-10">
      <PageHeader eyebrow={<span className="inline-flex items-center gap-1.5"><Radio className="size-3.5" aria-hidden /> Game Day</span>} title="This Week" description="Pick your event for schedules, live scores, brackets and updates. Refreshes automatically." />
      {q.isPending ? (
        <SkeletonList rows={2} />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={<CalendarDays className="size-6" />} title="No games this week" action={<LinkButton to="/tournaments">See upcoming tournaments</LinkButton>}>
          There are no tournaments in the next seven days.
        </EmptyState>
      ) : (
        <ul className="space-y-5">
          {q.data.map((t) => (
            <li key={t.id}>
              <Card className="overflow-hidden">
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {t.isToday && <span className="rounded bg-brand-flame px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">Today</span>}
                      <TournamentBadges {...t} />
                      {t.isDemo && <DemoTag />}
                    </div>
                    <h2 className="mt-2 text-2xl font-semibold uppercase">{t.title}</h2>
                    <p className="mt-1 text-sm text-ink-muted">
                      {formatDateRange(t.startsOn, t.endsOn)} · {t.venues.map((v) => v.name).join(', ') || t.region}
                    </p>
                  </div>
                </div>
                {t.activeAlerts.length > 0 && (
                  <div className="space-y-2 px-5 pb-4">
                    {t.activeAlerts.map((a) => (
                      <AlertBanner key={a.id} a={a} compact />
                    ))}
                  </div>
                )}
                <nav aria-label={`${t.title} quick links`} className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
                  {[
                    ['schedule', 'Schedule'],
                    ['scores', 'Scores'],
                    ['brackets', 'Brackets'],
                    ['updates', 'Updates'],
                  ].map(([to, label]) => (
                    <Link key={to} to={`/tournaments/${t.slug}/${to}`} className="bg-surface px-4 py-4 text-center text-[15px] font-semibold text-brand-navy hover:bg-brand-sky-soft">
                      {label}
                    </Link>
                  ))}
                </nav>
                {t.publishedGameCount === 0 && <p className="border-t border-line px-5 py-3 text-sm text-ink-muted">Game times haven't been published yet.</p>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Facilities ----------------------------------------------------------------------------------

export function Facilities() {
  useSeo({ title: 'Facilities', description: 'Ballparks used for 5 Diamonds tournaments: addresses, directions, parking and policies.' });
  const q = useQuery({ queryKey: ['facilities'], queryFn: () => api<{ id: string; slug: string; name: string; city: string | null; state: string | null; addressLine1: string | null; isDemo: boolean }[]>('/facilities') });
  return (
    <div className="container-page py-10">
      <PageHeader eyebrow="Ballparks" title="Facilities" description="Directions, parking and policies for each venue." />
      {q.isPending ? (
        <SkeletonList rows={2} />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title="Facility directory coming soon" />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((v) => (
            <li key={v.id} className="card relative p-5 hover:shadow-[var(--shadow-lift)]">
              {v.isDemo && <DemoTag className="mb-2" />}
              <h2 className="text-xl font-semibold uppercase">
                <Link to={`/facilities/${v.slug}`} className="after:absolute after:inset-0">
                  {v.name}
                </Link>
              </h2>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">
                <MapPin className="size-4" aria-hidden />
                {[v.addressLine1, v.city, v.state].filter(Boolean).join(', ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FacilityDetail() {
  const { slug = '' } = useParams();
  const q = useQuery({
    queryKey: ['facility', slug],
    queryFn: () =>
      api<{ name: string; addressLine1: string | null; city: string | null; state: string | null; postalCode: string | null; directions: string | null; parking: string | null; policies: string | null; mapUrl: string | null; isDemo: boolean; fields: { id: string; name: string; hasLights: boolean; notes: string | null }[] }>(`/facilities/${slug}`),
  });
  useSeo({ title: q.data?.name });
  if (q.isPending) return <div className="container-page py-10"><SkeletonList rows={2} /></div>;
  if (q.isError) return <div className="container-page py-10"><ErrorState error={q.error} retry={() => q.refetch()} /></div>;
  const v = q.data;
  const address = [v.addressLine1, v.city, [v.state, v.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return (
    <div className="container-page py-10">
      <PageHeader eyebrow={<Link to="/facilities" className="hover:underline">Facilities</Link>} title={v.name} description={address}>
        {v.isDemo && <DemoTag className="mt-2" />}
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {[
            ['Directions', v.directions],
            ['Parking', v.parking],
            ['Facility policies', v.policies],
          ].map(([h, body]) =>
            body ? (
              <Card key={h} className="p-5">
                <h2 className="font-display text-lg font-semibold uppercase">{h}</h2>
                <Markdown className="mt-2 text-sm">{body}</Markdown>
              </Card>
            ) : null,
          )}
        </div>
        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="font-display text-lg font-semibold uppercase">Fields</h2>
            <ul className="mt-3 divide-y divide-line text-sm">
              {v.fields.map((f) => (
                <li key={f.id} className="flex items-center justify-between py-2">
                  <span className="font-semibold">{f.name}</span>
                  {f.hasLights && <span className="inline-flex items-center gap-1 text-xs text-ink-muted"><Lightbulb className="size-3.5" aria-hidden /> Lights</span>}
                </li>
              ))}
            </ul>
          </Card>
          {address && (
            <a href={v.mapUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noopener noreferrer" className="card flex items-center justify-between p-4 font-semibold text-brand-navy hover:bg-brand-sky-soft">
              Open in Maps <ExternalLink className="size-4" aria-hidden />
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}

// ---- CMS pages -----------------------------------------------------------------------------------

interface PageContent {
  key: string;
  published: boolean;
  title: string | null;
  body: string | null;
  updatedAt: string | null;
  seoDescription: string | null;
}

export function ContentPage({ pageKey, fallbackTitle, legal }: { pageKey: string; fallbackTitle: string; legal?: boolean }) {
  const q = useQuery({ queryKey: ['content', pageKey], queryFn: () => api<PageContent>(`/content/pages?key=${pageKey}`) });
  useSeo({ title: q.data?.title ?? fallbackTitle, description: q.data?.seoDescription ?? undefined });
  return (
    <div className="container-page max-w-4xl py-10">
      {q.isPending ? (
        <SkeletonList rows={2} />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : !q.data.published ? (
        <>
          <PageHeader title={fallbackTitle} />
          <EmptyState title={legal ? 'This policy is being finalized' : 'Coming soon'}>
            {legal ? 'Our updated policy is under review and will be published here. Contact us with any questions in the meantime.' : 'This page is being prepared. Check back soon.'}
          </EmptyState>
        </>
      ) : (
        <>
          <PageHeader title={q.data.title ?? fallbackTitle} />
          <Card className="p-6 sm:p-8">
            <Markdown>{q.data.body}</Markdown>
            {q.data.updatedAt && <p className="mt-8 text-xs text-ink-subtle">Last updated {formatCalendarDate(q.data.updatedAt.slice(0, 10))}</p>}
          </Card>
        </>
      )}
    </div>
  );
}

export function NewsList() {
  useSeo({ title: 'News', description: 'News and announcements from 5 Diamonds Tournament Baseball.' });
  const q = useQuery({ queryKey: ['news'], queryFn: () => api<{ slug: string; title: string; excerpt: string | null; publishedAt: string | null; isDemo: boolean }[]>('/content/news') });
  return (
    <div className="container-page max-w-4xl py-10">
      <PageHeader eyebrow="Latest" title="News" />
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title="No news yet" />
      ) : (
        <ul className="space-y-4">
          {q.data.map((n) => (
            <li key={n.slug} className="card relative p-5 hover:shadow-[var(--shadow-lift)]">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                {n.publishedAt && formatCalendarDate(n.publishedAt.slice(0, 10))}
                {n.isDemo && <DemoTag />}
              </div>
              <h2 className="mt-1 text-xl font-semibold uppercase">
                <Link to={`/news/${n.slug}`} className="after:absolute after:inset-0">
                  {n.title}
                </Link>
              </h2>
              {n.excerpt && <p className="mt-1 text-ink-muted">{n.excerpt}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NewsPost() {
  const { slug = '' } = useParams();
  const q = useQuery({ queryKey: ['news', slug], queryFn: () => api<{ title: string; body: string | null; publishedAt: string | null; isDemo: boolean; excerpt: string | null }>(`/content/news?key=${encodeURIComponent(slug)}`) });
  useSeo({ title: q.data?.title, description: q.data?.excerpt ?? undefined });
  return (
    <div className="container-page max-w-3xl py-10">
      {q.isPending ? (
        <SkeletonList rows={2} />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : (
        <article>
          <PageHeader eyebrow={<Link to="/news" className="hover:underline">News</Link>} title={q.data.title}>
            <p className="mt-2 flex items-center gap-2 text-sm text-ink-subtle">
              {q.data.publishedAt && formatEasternStamp(q.data.publishedAt)} {q.data.isDemo && <DemoTag />}
            </p>
          </PageHeader>
          <Card className="p-6 sm:p-8">
            <Markdown>{q.data.body}</Markdown>
          </Card>
        </article>
      )}
    </div>
  );
}

export function Staff() {
  useSeo({ title: 'Staff' });
  const q = useQuery({ queryKey: ['staff-public'], queryFn: () => api<{ id: string; name: string; title: string; bio: string | null; publicEmail: string | null; publicPhone: string | null }[]>('/content/staff') });
  return (
    <div className="container-page py-10">
      <PageHeader eyebrow="Our team" title="Tournament Staff" />
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title="Staff directory coming soon">For questions now, use the contact page.</EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((s) => (
            <li key={s.id} className="card p-5">
              <div className="flex size-14 items-center justify-center rounded-full bg-brand-navy font-display text-xl font-bold text-white" aria-hidden>
                {s.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
              </div>
              <h2 className="mt-3 text-xl font-semibold uppercase">{s.name}</h2>
              <p className="text-sm font-semibold text-brand-flame">{s.title}</p>
              {s.bio && <p className="mt-2 text-sm text-ink-muted">{s.bio}</p>}
              <div className="mt-3 space-y-1 text-sm">
                {s.publicEmail && <a className="flex items-center gap-1.5 text-brand-navy hover:underline" href={`mailto:${s.publicEmail}`}><Mail className="size-4" aria-hidden /> {s.publicEmail}</a>}
                {s.publicPhone && <a className="flex items-center gap-1.5 text-brand-navy hover:underline" href={`tel:${s.publicPhone}`}><Phone className="size-4" aria-hidden /> {s.publicPhone}</a>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Partners() {
  useSeo({ title: 'Partners' });
  const q = useQuery({ queryKey: ['sponsors'], queryFn: () => api<{ id: string; name: string; websiteUrl: string | null; tier: string | null }[]>('/content/sponsors') });
  return (
    <div className="container-page py-10">
      <PageHeader eyebrow="Thank you" title="Partners & Sponsors" description="We appreciate the organizations that support youth baseball in the Triad." actions={<LinkButton to="/sponsorship" variant="secondary">Become a partner</LinkButton>} />
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title="Partner listings coming soon" action={<LinkButton to="/contact">Ask about sponsorship</LinkButton>} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {q.data.map((s) => (
            <li key={s.id} className="card flex flex-col items-center justify-center p-6 text-center">
              <p className="font-display text-xl font-semibold uppercase">{s.name}</p>
              {s.tier && <p className="text-xs text-ink-subtle">{s.tier}</p>}
              {s.websiteUrl && <a href={s.websiteUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-navy hover:underline">Visit <ExternalLink className="size-3.5" aria-hidden /></a>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Faq() {
  useSeo({ title: 'FAQ' });
  const q = useQuery({ queryKey: ['faqs'], queryFn: () => api<{ id: string; question: string; answer: string }[]>('/content/faqs') });
  return (
    <div className="container-page max-w-3xl py-10">
      <PageHeader eyebrow="Help" title="Frequently Asked Questions" />
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title="No FAQs yet" />
      ) : (
        <div className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          {q.data.map((f) => (
            <details key={f.id} className="group p-5">
              <summary className="cursor-pointer list-none font-semibold text-ink marker:hidden">
                <span className="flex items-center justify-between gap-4">
                  {f.question}
                  <span className="text-brand-flame transition group-open:rotate-45" aria-hidden>+</span>
                </span>
              </summary>
              <Markdown className="mt-3 text-sm">{f.answer}</Markdown>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

export function Contact() {
  useSeo({ title: 'Contact', description: 'Questions about registration, sponsorship or getting involved? Send us a message.' });
  const [form, setForm] = useState({ name: '', email: '', phone: '', topic: 'general', message: '', website: '' });
  const m = useMutation({ mutationFn: () => api('/contact', { body: form }) });
  const fieldErr = (k: string) => (m.error instanceof ApiRequestError ? m.error.fields[k] : undefined);
  if (m.isSuccess) {
    return (
      <div className="container-page max-w-2xl py-10">
        <PageHeader title="Message sent" />
        <Alert tone="ok" title="Thanks, we received your message.">Staff will reply to the email you provided. For game-day issues, check the tournament's Updates page.</Alert>
      </div>
    );
  }
  return (
    <div className="container-page max-w-2xl py-10">
      <PageHeader eyebrow="Get in touch" title="Contact Us" description="For registration questions, sponsorship, or getting involved." />
      <Card className="p-6">
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <FormError error={m.error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Your name" required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={fieldErr('name')} />
            <TextField label="Email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={fieldErr('email')} />
            <TextField label="Phone" type="tel" autoComplete="tel" hint="Optional" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <SelectField label="Topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}>
              <option value="general">General question</option>
              <option value="registration">Team registration</option>
              <option value="sponsorship">Sponsorship / partnership</option>
              <option value="get_involved">Get involved / bring a team</option>
              <option value="media">Photos & media</option>
              <option value="other">Other</option>
            </SelectField>
          </div>
          <TextArea label="Message" required rows={6} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} error={fieldErr('message')} />
          {/* Honeypot: hidden from people and assistive tech */}
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Website <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            </label>
          </div>
          <p className="text-xs text-ink-subtle">Please don't include players' personal information. Messages are visible only to authorized staff.</p>
          <Button type="submit" loading={m.isPending}>
            Send message
          </Button>
        </form>
      </Card>
    </div>
  );
}

export function NotFound() {
  useSeo({ title: 'Page not found', noindex: true });
  return (
    <div className="container-page py-20 text-center">
      <p className="font-display text-7xl font-bold text-brand-navy">404</p>
      <h1 className="mt-2 text-2xl font-semibold uppercase">That page is out of the park</h1>
      <p className="mt-2 text-ink-muted">The page you're looking for doesn't exist or has moved.</p>
      <div className="mt-6 flex justify-center gap-3">
        <LinkButton to="/">Home</LinkButton>
        <LinkButton to="/tournaments" variant="secondary">
          Find a tournament
        </LinkButton>
      </div>
    </div>
  );
}
