import type { AdminDivision, AdminTournament, TournamentStatus } from '@fd/shared';
import { easternDateKey, easternTimeKey, easternWallTimeToUtc, STATUS_LABELS, TIEBREAKER_LABELS, TIEBREAKERS, TOURNAMENT_TRANSITIONS, type Tiebreaker } from '@fd/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Building2, ClipboardCheck, FileText, Gauge, Handshake, HelpCircle, Inbox, Newspaper, Plus, ScrollText, Shield, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router';
import { Alert, Badge, Button, Card, Checkbox, cx, DemoTag, Dialog, EmptyState, ErrorState, FormError, LinkButton, PageHeader, SelectField, SkeletonList, TextArea, TextField } from '../../components/ui';
import { api, ApiRequestError } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { formatDateRange, formatEasternStamp } from '../../lib/format';
import { useSeo } from '../../lib/seo';

export const useAdminTournament = (id: string) => useQuery({ queryKey: ['admin-tournament', id], queryFn: () => api<AdminTournament>(`/admin/tournaments/${id}`) });
export const useVenues = () =>
  useQuery({ queryKey: ['admin-venues'], queryFn: () => api<{ id: string; name: string; slug: string; city: string | null; state: string | null; isPublished: boolean; version: number; addressLine1: string | null; postalCode: string | null; directions: string | null; parking: string | null; policies: string | null; mapUrl: string | null; fields: { id: string; name: string; hasLights: boolean; isActive: boolean; notes: string | null }[] }[]>('/admin/venues') });

const statusTone: Record<TournamentStatus, 'neutral' | 'ok' | 'info' | 'navy' | 'danger'> = { draft: 'neutral', published_open: 'ok', registration_closed: 'info', in_progress: 'navy', completed: 'neutral', canceled: 'danger' };
export const TStatus = ({ s }: { s: TournamentStatus }) => <Badge tone={statusTone[s]} dot>{STATUS_LABELS.tournament[s]}</Badge>;

export function AdminLayout() {
  useSeo({ title: 'Admin', noindex: true });
  const me = useMe();
  const roles = me.data?.roles ?? [];
  const isAdmin = roles.some((r) => r.role === 'super_admin');
  const isDirector = isAdmin || roles.some((r) => r.role === 'tournament_director');
  const isEditor = isAdmin || roles.some((r) => r.role === 'content_editor');
  const items = [
    { to: '/admin', label: 'Overview', icon: Gauge, end: true, show: true },
    { to: '/admin/tournaments', label: 'Tournaments', icon: Trophy, show: isDirector },
    { to: '/admin/my-games', label: 'Score entry', icon: ClipboardCheck, show: true },
    { to: '/admin/venues', label: 'Venues & fields', icon: Building2, show: isDirector },
    { to: '/admin/content', label: 'Pages', icon: FileText, show: isEditor },
    { to: '/admin/news', label: 'News', icon: Newspaper, show: isEditor },
    { to: '/admin/partners', label: 'Partners & staff', icon: Handshake, show: isEditor },
    { to: '/admin/faqs', label: 'FAQs', icon: HelpCircle, show: isEditor },
    { to: '/admin/inquiries', label: 'Inquiries', icon: Inbox, show: isEditor },
    { to: '/admin/staff', label: 'Staff & roles', icon: Shield, show: isAdmin },
    { to: '/admin/audit-log', label: 'Audit log', icon: ScrollText, show: isAdmin },
  ];
  return (
    <div className="mx-auto grid w-full max-w-[1500px] grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[230px_1fr]">
      <nav aria-label="Admin" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <p className="mb-2 hidden px-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle lg:block">Staff tools</p>
        <ul className="flex gap-1 overflow-x-auto lg:flex-col">
          {items.filter((i) => i.show).map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink to={to} end={end} className={({ isActive }) => cx('flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold', isActive ? 'bg-brand-navy text-white' : 'text-ink-muted hover:bg-surface hover:text-ink')}>
                <Icon className="size-4" aria-hidden /> {label}
              </NavLink>
            </li>
          ))}
        </ul>
        {me.data?.user && !me.data.user.twoFactorEnabled && (
          <Alert tone="warn" className="mt-4 hidden lg:flex" title="Enable two-factor">
            <Link to="/dashboard/profile" className="font-semibold text-brand-navy underline">Set up 2FA</Link> — required for staff at launch.
          </Alert>
        )}
      </nav>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

export function AdminOverview() {
  const q = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<{ tournaments: { id: string; title: string; slug: string; status: TournamentStatus; startsOn: string; endsOn: string; isDemo: boolean }[]; activeNotices: number; recent: { id: string; at: string; actor: string | null; action: string; summary: string | null; reason: string | null }[] }>('/admin/overview'), refetchInterval: 30_000 });
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const live = q.data.tournaments.filter((t) => t.status === 'in_progress');
  return (
    <>
      <PageHeader eyebrow="Operations" title="Overview" actions={<LinkButton to="/admin/tournaments/new"><Plus className="size-4" aria-hidden /> New tournament</LinkButton>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Live now" value={live.length} />
        <Stat label="Active notices" value={q.data.activeNotices} />
        <Stat label="Tournaments" value={q.data.tournaments.length} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-lg font-semibold uppercase">Tournaments</h2>
          {q.data.tournaments.length === 0 ? <p className="text-sm text-ink-muted">None yet.</p> : (
            <ul className="divide-y divide-line">
              {q.data.tournaments.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link to={`/admin/tournaments/${t.id}`} className="font-semibold hover:underline">{t.title}</Link> {t.isDemo && <DemoTag />}
                    <p className="text-xs text-ink-subtle">{formatDateRange(t.startsOn, t.endsOn)}</p>
                  </div>
                  <TStatus s={t.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold uppercase"><Activity className="size-5" aria-hidden /> Recent changes</h2>
          {q.data.recent.length === 0 ? <p className="text-sm text-ink-muted">No activity yet.</p> : (
            <ul className="space-y-3 text-sm">
              {q.data.recent.map((e) => (
                <li key={e.id}>
                  <p><span className="font-semibold">{e.actor ?? 'System'}</span> <span className="text-ink-muted">{e.action}</span> {e.summary && <span className="text-ink-muted">· {e.summary}</span>}</p>
                  <p className="text-xs text-ink-subtle">{formatEasternStamp(e.at)}{e.reason ? ` · “${e.reason}”` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

const Stat = ({ label, value }: { label: string; value: number }) => (
  <Card className="p-5">
    <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">{label}</p>
    <p className="tabular mt-1 font-display text-4xl font-bold text-brand-navy">{value}</p>
  </Card>
);

export function AdminTournamentList() {
  const q = useQuery({ queryKey: ['admin-tournaments'], queryFn: () => api<AdminTournament[]>('/admin/tournaments') });
  return (
    <>
      <PageHeader title="Tournaments" actions={<LinkButton to="/admin/tournaments/new"><Plus className="size-4" aria-hidden /> New tournament</LinkButton>} />
      {q.isPending ? <SkeletonList /> : q.isError ? <ErrorState error={q.error} retry={() => q.refetch()} /> : q.data.length === 0 ? <EmptyState title="No tournaments" action={<LinkButton to="/admin/tournaments/new">Create the first one</LinkButton>} /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-alt text-left text-xs uppercase tracking-wider text-ink-muted">
              <tr><th className="px-4 py-2.5">Tournament</th><th className="px-4 py-2.5">Dates</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Review</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.map((t) => (
                <tr key={t.id} className="hover:bg-surface-alt">
                  <td className="px-4 py-3"><Link to={`/admin/tournaments/${t.id}`} className="font-semibold text-brand-navy hover:underline">{t.title}</Link> {t.isDemo && <DemoTag />}<div className="text-xs text-ink-subtle">/{t.slug}</div></td>
                  <td className="px-4 py-3">{formatDateRange(t.startsOn, t.endsOn)}</td>
                  <td className="px-4 py-3"><TStatus s={t.status} /></td>
                  <td className="px-4 py-3 text-ink-muted">{t.reviewMode === 'auto_confirm' ? 'Auto-confirm' : 'Manual review'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

// ---- Tournament form ------------------------------------------------------------------------------

type TForm = Record<string, any>;
// datetime-local inputs are interpreted as Eastern wall-clock time regardless of the browser zone (ADR-011).
const toLocalInput = (iso: string | null) => (iso ? `${easternDateKey(iso)}T${easternTimeKey(iso)}` : '');
const fromLocalInput = (v: string) => (v ? easternWallTimeToUtc(v.slice(0, 10), v.slice(11, 16)).toISOString() : null);

const blank: TForm = { title: '', slug: '', startsOn: '', endsOn: '', region: '', category: '', summary: '', description: '', registrationOpensAt: '', registrationClosesAt: '', rosterLocksAt: '', feeInfo: '', refundPolicyUrl: '', rulesText: '', operationalContacts: '', reviewMode: 'manual_review', waitlistEnabled: true, paymentRequired: false, publicTeamNames: true, fieldBufferMinutes: 0, minTeamRestMinutes: 0, venueIds: [] as string[] };

function toPayload(f: TForm) {
  const n = (v: string) => (v?.trim() ? v.trim() : null);
  return {
    ...f,
    region: n(f.region), category: n(f.category), summary: n(f.summary), description: n(f.description), feeInfo: n(f.feeInfo), refundPolicyUrl: n(f.refundPolicyUrl), rulesText: n(f.rulesText), operationalContacts: n(f.operationalContacts),
    registrationOpensAt: fromLocalInput(f.registrationOpensAt), registrationClosesAt: fromLocalInput(f.registrationClosesAt), rosterLocksAt: fromLocalInput(f.rosterLocksAt),
    fieldBufferMinutes: Number(f.fieldBufferMinutes) || 0, minTeamRestMinutes: Number(f.minTeamRestMinutes) || 0,
  };
}

function TournamentForm({ initial, onSubmit, pending, error, submitLabel, lockReview }: { initial: TForm; onSubmit: (p: ReturnType<typeof toPayload>) => void; pending: boolean; error: unknown; submitLabel: string; lockReview?: boolean }) {
  const [f, setF] = useState(initial);
  const venues = useVenues();
  const fe = (k: string) => (error instanceof ApiRequestError ? error.fields[k] : undefined);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="space-y-6" onSubmit={(e) => (e.preventDefault(), onSubmit(toPayload(f)))}>
      <FormError error={error} />
      <section className="grid gap-4 sm:grid-cols-2">
        <TextField label="Title" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value, slug: f.slugTouched ? f.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} error={fe('title')} />
        <TextField label="URL slug" required hint={`/tournaments/${f.slug || '…'}`} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value, slugTouched: true })} error={fe('slug')} />
        <TextField label="Start date" type="date" required value={f.startsOn} onChange={set('startsOn')} error={fe('startsOn')} />
        <TextField label="End date" type="date" required value={f.endsOn} onChange={set('endsOn')} error={fe('endsOn')} />
        <TextField label="Region" value={f.region} onChange={set('region')} />
        <TextField label="Category" placeholder="e.g. Weekend tournament" value={f.category} onChange={set('category')} />
      </section>
      <TextField label="Card summary" hint="One line shown on tournament cards." value={f.summary} onChange={set('summary')} />
      <TextArea label="Description (Markdown)" rows={5} value={f.description} onChange={set('description')} />
      <fieldset className="rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold">Venues</legend>
        {venues.data?.length === 0 && <p className="text-sm text-ink-muted">No venues yet. <Link to="/admin/venues" className="font-semibold text-brand-navy underline">Add a venue</Link>.</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {venues.data?.map((v) => (
            <Checkbox key={v.id} label={v.name} hint={`${v.fields.length} fields`} checked={f.venueIds.includes(v.id)} onChange={(e) => setF({ ...f, venueIds: e.target.checked ? [...f.venueIds, v.id] : f.venueIds.filter((x: string) => x !== v.id) })} />
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-4 rounded-xl border border-line p-4 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">Registration (Eastern time)</legend>
        <TextField label="Opens" type="datetime-local" hint="Blank = opens when published" value={f.registrationOpensAt} onChange={set('registrationOpensAt')} />
        <TextField label="Closes" type="datetime-local" value={f.registrationClosesAt} onChange={set('registrationClosesAt')} error={fe('registrationClosesAt')} />
        <TextField label="Roster deadline" type="datetime-local" value={f.rosterLocksAt} onChange={set('rosterLocksAt')} />
        <SelectField label="Review mode" value={f.reviewMode} onChange={set('reviewMode')} disabled={lockReview} hint={lockReview ? 'Locked after teams register.' : 'Choose before opening registration.'} error={fe('reviewMode')}>
          <option value="manual_review">Manual review (spot held)</option>
          <option value="auto_confirm">Auto-confirm when space</option>
        </SelectField>
        <div className="space-y-3 sm:col-span-2 sm:pt-6">
          <Checkbox label="Offer a waitlist when divisions are full" checked={f.waitlistEnabled} onChange={(e) => setF({ ...f, waitlistEnabled: e.target.checked })} />
          <Checkbox label="Payment required (tracked separately; no charges until a provider is configured)" checked={f.paymentRequired} onChange={(e) => setF({ ...f, paymentRequired: e.target.checked })} />
          <Checkbox label="Show registered team names publicly" hint="Rosters are never public." checked={f.publicTeamNames} onChange={(e) => setF({ ...f, publicTeamNames: e.target.checked })} />
        </div>
      </fieldset>
      <fieldset className="grid gap-4 rounded-xl border border-line p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Scheduling preferences (warnings)</legend>
        <TextField label="Field turnaround (minutes)" type="number" min={0} max={120} value={f.fieldBufferMinutes} onChange={set('fieldBufferMinutes')} />
        <TextField label="Minimum team rest (minutes)" type="number" min={0} max={600} value={f.minTeamRestMinutes} onChange={set('minTeamRestMinutes')} />
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Fees (informational)" hint="Only enter confirmed fees." value={f.feeInfo} onChange={set('feeInfo')} />
        <TextField label="Refund / withdrawal policy URL" type="url" value={f.refundPolicyUrl} onChange={set('refundPolicyUrl')} error={fe('refundPolicyUrl')} />
      </div>
      <TextArea label="Event rules (Markdown)" rows={5} value={f.rulesText} onChange={set('rulesText')} />
      <TextArea label="Operational contacts" hint="Public. Only list contacts approved for publication." rows={2} value={f.operationalContacts} onChange={set('operationalContacts')} />
      <Button type="submit" loading={pending}>{submitLabel}</Button>
    </form>
  );
}

export function AdminTournamentNew() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (p: object) => api<AdminTournament>('/admin/tournaments', { body: p }),
    onSuccess: (t) => (qc.invalidateQueries({ queryKey: ['admin-tournaments'] }), nav(`/admin/tournaments/${t.id}/divisions`)),
  });
  return (
    <>
      <PageHeader eyebrow={<Link to="/admin/tournaments" className="hover:underline">Tournaments</Link>} title="New tournament" description="Saved as a draft. Nothing is public until you publish." />
      <Card className="p-6"><TournamentForm initial={blank} onSubmit={(p) => m.mutate(p)} pending={m.isPending} error={m.error} submitLabel="Create draft" /></Card>
    </>
  );
}

// ---- Tournament workspace ---------------------------------------------------------------------------

const adminTabs = [
  ['', 'Setup'],
  ['divisions', 'Divisions'],
  ['registrations', 'Registrations'],
  ['schedule', 'Schedule'],
  ['brackets', 'Brackets'],
  ['updates', 'Notices'],
  ['audit', 'Audit'],
] as const;

export function AdminTournamentLayout() {
  const { id = '' } = useParams();
  const t = useAdminTournament(id);
  if (t.isPending) return <SkeletonList />;
  if (t.isError) return <ErrorState error={t.error} retry={() => t.refetch()} />;
  const d = t.data;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/admin/tournaments" className="text-sm text-ink-muted hover:underline">Tournaments</Link>
          <h1 className="mt-1 text-3xl font-semibold uppercase">{d.title} {d.isDemo && <DemoTag />}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <TStatus s={d.status} /> {formatDateRange(d.startsOn, d.endsOn)}
            <span>· {d.counts.confirmed} confirmed · {d.counts.pending} pending · {d.counts.waitlisted} waitlisted</span>
          </div>
        </div>
        <div className="flex gap-2">
          {d.status !== 'draft' && <LinkButton to={`/tournaments/${d.slug}`} variant="secondary" size="sm" target="_blank">View public page</LinkButton>}
        </div>
      </div>
      <nav aria-label="Tournament admin" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {adminTabs.map(([to, label]) => (
          <NavLink key={label} to={to} end={to === ''} className={({ isActive }) => cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold', isActive ? 'border-brand-flame text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
            {label}
            {label === 'Schedule' && d.counts.unpublishedGameChanges > 0 && <span className="ml-1.5 rounded-full bg-warn-soft px-1.5 text-xs text-warn">{d.counts.unpublishedGameChanges}</span>}
            {label === 'Registrations' && d.counts.pending > 0 && <span className="ml-1.5 rounded-full bg-warn-soft px-1.5 text-xs text-warn">{d.counts.pending}</span>}
          </NavLink>
        ))}
      </nav>
      <Outlet context={d} />
    </>
  );
}

export const useAdminT = () => useOutletContext<AdminTournament>();

export function AdminTournamentSetup() {
  const t = useAdminT();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-tournament', t.id] });
  const save = useMutation({ mutationFn: (p: object) => api(`/admin/tournaments/${t.id}`, { method: 'PATCH', body: { version: t.version, data: p } }), onSuccess: refresh });
  const [transition, setTransition] = useState<TournamentStatus | null>(null);
  const [reason, setReason] = useState('');
  const move = useMutation({ mutationFn: () => api(`/admin/tournaments/${t.id}/transition`, { body: { version: t.version, to: transition, reason: reason || null } }), onSuccess: () => (setTransition(null), setReason(''), refresh()) });
  const lockNow = useMutation({ mutationFn: (locked: boolean) => api(`/admin/tournaments/${t.id}/roster-lock`, { body: { version: t.version, locked, reason: locked ? undefined : prompt('Reason for reopening roster edits?') ?? '' } }), onSuccess: refresh });
  const rosterLocked = !!t.rosterLocksAt && new Date(t.rosterLocksAt) <= new Date();
  const initial: TForm = { ...blank, ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v ?? ''])), registrationOpensAt: toLocalInput(t.registrationOpensAt), registrationClosesAt: toLocalInput(t.registrationClosesAt), rosterLocksAt: toLocalInput(t.rosterLocksAt), slugTouched: true };
  return (
    <div className="grid gap-6 2xl:grid-cols-[1fr_340px]">
      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold uppercase">Event details</h2>
        {save.isSuccess && <Alert tone="ok" title="Saved" className="mb-4" />}
        <TournamentForm key={t.version} initial={initial} onSubmit={(p) => save.mutate(p)} pending={save.isPending} error={save.error} submitLabel="Save changes" lockReview={t.counts.confirmed + t.counts.pending + t.counts.waitlisted > 0} />
      </Card>
      <div className="space-y-4">
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider">Lifecycle</h2>
          <p className="mt-2 text-sm">Current: <TStatus s={t.status} /></p>
          <div className="mt-3 flex flex-col gap-2">
            {TOURNAMENT_TRANSITIONS[t.status].map((s) => (
              <Button key={s} variant={s === 'canceled' ? 'secondary' : s === 'published_open' ? 'flame' : 'primary'} size="sm" onClick={() => setTransition(s)}>
                {s === 'published_open' ? (t.status === 'draft' ? 'Publish & open registration' : 'Reopen registration') : s === 'draft' ? 'Unpublish (back to draft)' : `Move to ${STATUS_LABELS.tournament[s]}`}
              </Button>
            ))}
          </div>
          {t.status === 'draft' && t.divisions.length === 0 && <p className="mt-2 text-xs text-warn">Add a division before publishing.</p>}
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider">Roster editing</h2>
          <p className="mt-2 text-sm text-ink-muted">{rosterLocked ? `Locked since ${formatEasternStamp(t.rosterLocksAt!)}. Submitted rosters are frozen.` : t.rosterLocksAt ? `Locks ${formatEasternStamp(t.rosterLocksAt)}.` : 'No deadline set.'}</p>
          <FormError error={lockNow.error} />
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => lockNow.mutate(!rosterLocked)} loading={lockNow.isPending}>{rosterLocked ? 'Reopen roster edits' : 'Lock rosters now'}</Button>
        </Card>
      </div>
      <Dialog open={!!transition} onClose={() => setTransition(null)} title="Change tournament status" footer={<><Button variant="secondary" onClick={() => setTransition(null)}>Cancel</Button><Button onClick={() => move.mutate()} loading={move.isPending}>Confirm</Button></>}>
        <p className="text-sm text-ink-muted">{t.status} → <strong>{transition}</strong>. Closing registration never removes confirmed teams. All changes are logged.</p>
        <FormError error={move.error} />
        <TextArea className="mt-4" label="Reason" hint="Required for cancellations and reversals." rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Dialog>
    </div>
  );
}

// ---- Divisions -------------------------------------------------------------------------------------

const blankDiv = { name: '', ageLabel: '', classification: '', capacity: 8, rosterMin: '', rosterMax: 15, allowDuplicateJersey: false, rulesText: '', gameFormat: '', defaultGameMinutes: 90, tiesAllowedInPool: true, tiebreakers: [] as Tiebreaker[], runDifferentialCap: '', standingsSignedOff: false, sortOrder: 0 };

export function AdminDivisions() {
  const t = useAdminT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AdminDivision | 'new' | null>(null);
  const del = useMutation({ mutationFn: (id: string) => api(`/admin/divisions/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-tournament', t.id] }) });
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold uppercase">Divisions</h2>
        <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> Add division</Button>
      </div>
      <FormError error={del.error} />
      {t.divisions.length === 0 ? <EmptyState title="No divisions yet">Divisions hold capacity, roster limits, rules and standings settings.</EmptyState> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {t.divisions.map((d) => (
            <Card key={d.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-xl font-semibold uppercase">{d.name}</h3>
                  <p className="text-sm text-ink-muted">{d.ageLabel}{d.classification ? ` · ${d.classification}` : ''} · {d.defaultGameMinutes} min games</p>
                </div>
                <Badge tone={d.heldSpots >= d.capacity ? 'danger' : 'ok'}>{d.heldSpots} / {d.capacity} spots</Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-muted">
                <div>Roster: {d.rosterMin ?? 0}–{d.rosterMax ?? '∞'}</div>
                <div>Waitlisted: {d.waitlisted}</div>
                <div>Pool ties: {d.tiesAllowedInPool ? 'allowed' : 'not allowed'}</div>
                <div>Standings: {d.standingsSignedOff && d.tiebreakers.length ? <span className="text-ok">signed off</span> : <span className="text-warn">unofficial</span>}</div>
              </dl>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(d)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => confirm(`Delete ${d.name}?`) && del.mutate(d.id)}>Delete</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <DivisionDialog t={t} d={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function DivisionDialog({ t, d, onClose }: { t: AdminTournament; d: AdminDivision | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<any>(d ? { ...d, classification: d.classification ?? '', rosterMin: d.rosterMin ?? '', rosterMax: d.rosterMax ?? '', rulesText: d.rulesText ?? '', gameFormat: d.gameFormat ?? '', runDifferentialCap: d.runDifferentialCap ?? '' } : blankDiv);
  const num = (v: any) => (v === '' || v === null ? null : Number(v));
  const body = { ...f, classification: f.classification || null, rulesText: f.rulesText || null, gameFormat: f.gameFormat || null, capacity: Number(f.capacity), rosterMin: num(f.rosterMin), rosterMax: num(f.rosterMax), runDifferentialCap: num(f.runDifferentialCap), defaultGameMinutes: Number(f.defaultGameMinutes), sortOrder: Number(f.sortOrder) };
  const m = useMutation({
    mutationFn: () => {
      const { id: _i, version: _v, heldSpots: _h, waitlisted: _w, ...data } = body;
      return d ? api(`/admin/divisions/${d.id}`, { method: 'PATCH', body: { version: d.version, data } }) : api(`/admin/tournaments/${t.id}/divisions`, { body: data });
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['admin-tournament', t.id] }), onClose()),
  });
  const fe = (k: string) => (m.error instanceof ApiRequestError ? m.error.fields[k] : undefined);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open onClose={onClose} wide title={d ? `Edit ${d.name}` : 'Add division'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Save division</Button></>}>
      <div className="space-y-4">
        <FormError error={m.error} />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Name" required value={f.name} onChange={set('name')} error={fe('name')} />
          <TextField label="Age label" required placeholder="10U" value={f.ageLabel} onChange={set('ageLabel')} error={fe('ageLabel')} />
          <TextField label="Classification" hint="Optional (e.g. AA)" value={f.classification} onChange={set('classification')} />
          <TextField label="Team capacity" type="number" min={1} required value={f.capacity} onChange={set('capacity')} error={fe('capacity')} />
          <TextField label="Roster min" type="number" min={0} value={f.rosterMin} onChange={set('rosterMin')} />
          <TextField label="Roster max" type="number" min={1} value={f.rosterMax} onChange={set('rosterMax')} error={fe('rosterMin')} />
          <TextField label="Default game length (min)" type="number" min={15} value={f.defaultGameMinutes} onChange={set('defaultGameMinutes')} />
          <TextField label="Display order" type="number" value={f.sortOrder} onChange={set('sortOrder')} />
        </div>
        <TextField label="Game format" hint="Describe only what the owner has confirmed (e.g. 3 pool games + single elimination)." value={f.gameFormat} onChange={set('gameFormat')} />
        <TextArea label="Division rules (Markdown)" rows={3} value={f.rulesText} onChange={set('rulesText')} />
        <Checkbox label="Allow duplicate jersey numbers" checked={f.allowDuplicateJersey} onChange={(e) => setF({ ...f, allowDuplicateJersey: e.target.checked })} />
        <Checkbox label="Allow ties in pool play" checked={f.tiesAllowedInPool} onChange={(e) => setF({ ...f, tiesAllowedInPool: e.target.checked })} />
        <fieldset className="rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Standings tie-breakers (in order)</legend>
          <p className="mb-3 text-xs text-ink-subtle">Standings show as Unofficial until tie-breakers are chosen and signed off. Seeds can always be set manually.</p>
          <ol className="space-y-2">
            {f.tiebreakers.map((tb: Tiebreaker, i: number) => (
              <li key={tb} className="flex items-center justify-between rounded-lg bg-surface-alt px-3 py-2 text-sm">
                <span>{i + 1}. {TIEBREAKER_LABELS[tb]}</span>
                <Button size="sm" variant="ghost" onClick={() => setF({ ...f, tiebreakers: f.tiebreakers.filter((x: string) => x !== tb), standingsSignedOff: false })}>Remove</Button>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            {TIEBREAKERS.filter((tb) => !f.tiebreakers.includes(tb)).map((tb) => (
              <Button key={tb} size="sm" variant="secondary" onClick={() => setF({ ...f, tiebreakers: [...f.tiebreakers, tb], standingsSignedOff: false })}>+ {TIEBREAKER_LABELS[tb]}</Button>
            ))}
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <TextField label="Run differential cap per game" type="number" min={1} hint="Blank = uncapped" value={f.runDifferentialCap} onChange={set('runDifferentialCap')} />
            <div className="sm:pt-7"><Checkbox label="Policy signed off by director" checked={f.standingsSignedOff} disabled={!f.tiebreakers.length} onChange={(e) => setF({ ...f, standingsSignedOff: e.target.checked })} /></div>
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}

