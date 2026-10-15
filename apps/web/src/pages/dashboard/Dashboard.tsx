import type { ManagerTeam, PublicGame, RegistrationDto, RosterSnapshotDto } from '@fd/shared';
import { teamInput } from '@fd/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarDays, ClipboardList, Home, LogOut, Plus, Settings, ShieldCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router';
import { GameCard } from '../../components/GameCard';
import { PaymentBadge, RegistrationBadge } from '../../components/status';
import { Alert, Badge, Button, Card, Checkbox, cx, Dialog, EmptyState, ErrorState, FormError, LinkButton, PageHeader, SelectField, SkeletonList, TextArea, TextField } from '../../components/ui';
import { api, ApiRequestError } from '../../lib/api';
import { useAuthActions, useMe } from '../../lib/auth';
import { formatDateRange, formatEasternStamp } from '../../lib/format';
import { useSeo } from '../../lib/seo';
import { useTournament } from '../public/TournamentPages';

export const useMyTeams = () => useQuery({ queryKey: ['my-teams'], queryFn: () => api<ManagerTeam[]>('/me/teams') });
export const useMyRegistrations = () => useQuery({ queryKey: ['my-registrations'], queryFn: () => api<RegistrationDto[]>('/me/registrations') });

const nav = [
  { to: '/dashboard', label: 'Overview', icon: Home, end: true },
  { to: '/dashboard/teams', label: 'Teams', icon: Users },
  { to: '/dashboard/registrations', label: 'Registrations', icon: ClipboardList },
  { to: '/dashboard/notifications', label: 'Notifications', icon: Bell },
  { to: '/dashboard/profile', label: 'Account', icon: Settings },
];

export function DashboardLayout() {
  useSeo({ title: 'Coach Portal', noindex: true });
  return (
    <div className="container-page grid grid-cols-1 gap-8 py-8 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Coach portal" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <ul className="flex gap-1 overflow-x-auto lg:flex-col">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink to={to} end={end} className={({ isActive }) => cx('flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-semibold', isActive ? 'bg-brand-navy text-white' : 'text-ink-muted hover:bg-surface hover:text-ink')}>
                <Icon className="size-4" aria-hidden /> {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

export function DashboardHome() {
  const me = useMe();
  const teams = useMyTeams();
  const regs = useMyRegistrations();
  const games = useQuery({ queryKey: ['my-games'], queryFn: () => api<(PublicGame & { tournament: { slug: string; title: string } })[]>('/me/games'), refetchInterval: 60_000 });
  const first = me.data?.user?.name.split(' ')[0];
  return (
    <>
      <PageHeader eyebrow="Coach portal" title={first ? `Welcome, ${first}` : 'Welcome'} actions={<LinkButton to="/tournaments" variant="flame"><Plus className="size-4" aria-hidden /> Enter a tournament</LinkButton>} />
      {teams.data?.length === 0 && (
        <Alert tone="info" title="Start by adding your team" className="mb-6">
          Teams hold your roster and can be entered into any tournament. <Link to="/dashboard/teams/new" className="font-semibold text-brand-navy underline">Add a team</Link>
        </Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="up-h">
          <h2 id="up-h" className="mb-3 text-lg font-semibold uppercase">Upcoming games</h2>
          {games.isPending ? (
            <SkeletonList rows={2} />
          ) : games.isError ? (
            <ErrorState error={games.error} retry={() => games.refetch()} />
          ) : games.data.length === 0 ? (
            <EmptyState icon={<CalendarDays className="size-6" />} title="No games scheduled">Games appear here once a director publishes the schedule.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {games.data.slice(0, 6).map((g) => (
                <li key={g.id}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                    <Link to={`/tournaments/${g.tournament.slug}/schedule`} className="hover:underline">{g.tournament.title}</Link>
                  </p>
                  <GameCard g={g} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="reg-h">
          <h2 id="reg-h" className="mb-3 text-lg font-semibold uppercase">Registrations</h2>
          {regs.isPending ? <SkeletonList rows={2} /> : regs.isError ? <ErrorState error={regs.error} retry={() => regs.refetch()} /> : <RegistrationList regs={regs.data.slice(0, 5)} />}
          <h2 className="mb-3 mt-8 text-lg font-semibold uppercase">Your teams</h2>
          {teams.isPending ? <SkeletonList rows={2} /> : teams.isError ? <ErrorState error={teams.error} /> : <TeamList teams={teams.data} />}
        </section>
      </div>
    </>
  );
}

function RegistrationList({ regs }: { regs: RegistrationDto[] }) {
  if (!regs.length) return <EmptyState title="No registrations yet" action={<LinkButton to="/tournaments" size="sm">Find a tournament</LinkButton>} />;
  return (
    <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
      {regs.map((r) => (
        <li key={r.id} className="relative flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-surface-alt">
          <div className="min-w-0">
            <Link to={`/dashboard/registrations/${r.id}`} className="font-semibold text-ink after:absolute after:inset-0 hover:underline">
              {r.team.name} · {r.division.name}
            </Link>
            <p className="text-sm text-ink-muted">
              {r.tournament.title} · {formatDateRange(r.tournament.startsOn, r.tournament.endsOn)}
            </p>
            <p className="tabular text-xs text-ink-subtle">Ref {r.referenceCode}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <RegistrationBadge status={r.status} />
            {r.paymentStatus !== 'not_required' && <PaymentBadge status={r.paymentStatus} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

function TeamList({ teams }: { teams: ManagerTeam[] }) {
  if (!teams.length) return <EmptyState icon={<Users className="size-6" />} title="No teams yet" action={<LinkButton to="/dashboard/teams/new" size="sm">Add a team</LinkButton>} />;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {teams.map((t) => (
        <li key={t.id} className="card relative p-4 hover:shadow-[var(--shadow-lift)]">
          <Link to={`/dashboard/teams/${t.id}`} className="font-display text-lg font-semibold uppercase after:absolute after:inset-0">
            {t.name}
          </Link>
          <p className="text-sm text-ink-muted">
            {t.ageGroup}
            {t.city ? ` · ${t.city}${t.state ? `, ${t.state}` : ''}` : ''}
          </p>
          <div className="mt-2 flex gap-2">
            <Badge>{t.rosterCount} players</Badge>
            {t.activeRegistrations > 0 && <Badge tone="info">{t.activeRegistrations} active</Badge>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TeamsPage() {
  const teams = useMyTeams();
  return (
    <>
      <PageHeader title="Teams" description="Each team keeps its own private roster." actions={<LinkButton to="/dashboard/teams/new"><Plus className="size-4" aria-hidden /> Add team</LinkButton>} />
      {teams.isPending ? <SkeletonList /> : teams.isError ? <ErrorState error={teams.error} retry={() => teams.refetch()} /> : <TeamList teams={teams.data} />}
    </>
  );
}

const emptyTeam = { name: '', organizationName: '', ageGroup: '', city: '', state: '', coachContactName: '', coachContactPhone: '', coachContactEmail: '' };

function TeamForm({ initial, onSubmit, pending, error, submitLabel }: { initial: typeof emptyTeam; onSubmit: (d: typeof emptyTeam) => void; pending: boolean; error: unknown; submitLabel: string }) {
  const [f, setF] = useState(initial);
  const fe = (k: string) => (error instanceof ApiRequestError ? error.fields[k] : undefined);
  const set = (k: keyof typeof emptyTeam) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="space-y-5" onSubmit={(e) => (e.preventDefault(), onSubmit(f))}>
      <FormError error={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Team name" required value={f.name} onChange={set('name')} error={fe('name')} />
        <TextField label="Age group" required placeholder="e.g. 10U" value={f.ageGroup} onChange={set('ageGroup')} error={fe('ageGroup')} />
        <TextField label="Club / organization" hint="Optional" value={f.organizationName} onChange={set('organizationName')} />
        <div className="grid grid-cols-[1fr_90px] gap-3">
          <TextField label="City" value={f.city} onChange={set('city')} />
          <TextField label="State" maxLength={2} value={f.state} onChange={set('state')} error={fe('state')} />
        </div>
      </div>
      <fieldset className="rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold">Coach contact (private)</legend>
        <p className="mb-3 text-xs text-ink-subtle">Shared only with tournament staff for this team's events. Never public.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Contact name" value={f.coachContactName} onChange={set('coachContactName')} />
          <TextField label="Phone" type="tel" value={f.coachContactPhone} onChange={set('coachContactPhone')} />
          <TextField label="Email" type="email" value={f.coachContactEmail} onChange={set('coachContactEmail')} error={fe('coachContactEmail')} />
        </div>
      </fieldset>
      <Button type="submit" loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}

const clean = (f: typeof emptyTeam) => teamInput.parse({ ...f, organizationName: f.organizationName || null, city: f.city || null, state: f.state || null, coachContactName: f.coachContactName || null, coachContactPhone: f.coachContactPhone || null, coachContactEmail: f.coachContactEmail || null });

export function TeamNew() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (f: typeof emptyTeam) => api<ManagerTeam>('/me/teams', { body: clean(f) }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['my-teams'] });
      nav(`/dashboard/teams/${t.id}/roster`);
    },
  });
  return (
    <>
      <PageHeader eyebrow={<Link to="/dashboard/teams" className="hover:underline">Teams</Link>} title="Add a team" />
      <Card className="p-6">
        <TeamForm initial={emptyTeam} onSubmit={(f) => m.mutate(f)} pending={m.isPending} error={m.error} submitLabel="Create team & add roster" />
      </Card>
    </>
  );
}

export function TeamDetail() {
  const { teamId = '' } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const team = useQuery({ queryKey: ['my-team', teamId], queryFn: () => api<ManagerTeam>(`/me/teams/${teamId}`) });
  const regs = useMyRegistrations();
  const save = useMutation({
    mutationFn: (f: typeof emptyTeam) => api<ManagerTeam>(`/me/teams/${teamId}`, { method: 'PATCH', body: { version: team.data!.version, data: clean(f) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-team', teamId] }),
  });
  const del = useMutation({
    mutationFn: () => api(`/me/teams/${teamId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-teams'] });
      nav('/dashboard/teams');
    },
  });
  if (team.isPending) return <SkeletonList />;
  if (team.isError) return <ErrorState error={team.error} retry={() => team.refetch()} />;
  const t = team.data;
  const mine = regs.data?.filter((r) => r.team.id === teamId) ?? [];
  return (
    <>
      <PageHeader eyebrow={<Link to="/dashboard/teams" className="hover:underline">Teams</Link>} title={t.name} description={`${t.ageGroup} · ${t.rosterCount} players on roster`} actions={<LinkButton to="roster">Manage roster</LinkButton>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold uppercase">Team details</h2>
          {save.isSuccess && <Alert tone="ok" title="Saved" className="mb-4" />}
          <TeamForm key={t.version} initial={{ ...emptyTeam, ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v ?? ''])) } as typeof emptyTeam} onSubmit={(f) => save.mutate(f)} pending={save.isPending} error={save.error} submitLabel="Save changes" />
        </Card>
        <div className="space-y-4">
          <h2 className="text-lg font-semibold uppercase">Registrations</h2>
          <RegistrationList regs={mine} />
          <Card className="p-4">
            <h3 className="text-sm font-semibold">Remove team</h3>
            <p className="mt-1 text-xs text-ink-muted">Teams with active registrations can't be removed. Withdraw first.</p>
            <FormError error={del.error} />
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => confirm(`Remove ${t.name}? This hides the team and its roster from your account.`) && del.mutate()} loading={del.isPending}>
              Remove team
            </Button>
          </Card>
        </div>
      </div>
    </>
  );
}

// ---- Registration flow ---------------------------------------------------------------------------

export function RegisterForTournament() {
  const { slug = '' } = useParams();
  const t = useTournament(slug);
  const teams = useMyTeams();
  const qc = useQueryClient();
  const [teamId, setTeamId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [ack, setAck] = useState(false);
  const [waitlist, setWaitlist] = useState(false);
  const m = useMutation({
    mutationFn: () => api<{ registration: RegistrationDto; outcome: string }>('/registrations', { body: { teamId, divisionId, acknowledgeRules: ack, joinWaitlistIfFull: waitlist } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-registrations'] });
      qc.invalidateQueries({ queryKey: ['tournament', slug] });
    },
  });
  useSeo({ title: t.data ? `Register — ${t.data.title}` : 'Register', noindex: true });
  if (t.isPending || teams.isPending) return <div className="container-page py-10"><SkeletonList /></div>;
  if (t.isError) return <div className="container-page py-10"><ErrorState error={t.error} /></div>;
  const d = t.data;
  const division = d.divisions.find((x) => x.id === divisionId);
  const team = teams.data?.find((x) => x.id === teamId);
  const fullError = m.error instanceof ApiRequestError && m.error.code === 'CAPACITY_FULL';

  if (m.isSuccess) {
    const r = m.data.registration;
    return (
      <div className="container-page max-w-2xl py-10">
        <PageHeader eyebrow={d.title} title={m.data.outcome === 'confirmed' ? "You're in!" : m.data.outcome === 'waitlisted' ? "You're on the waitlist" : 'Spot held for review'} />
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-ink-muted">Reference number</p>
              <p className="tabular font-display text-3xl font-bold tracking-wider text-brand-navy">{r.referenceCode}</p>
            </div>
            <RegistrationBadge status={r.status} />
          </div>
          <p className="mt-4 text-sm text-ink-muted">
            {m.data.outcome === 'confirmed'
              ? `${r.team.name} is confirmed in ${r.division.name}.`
              : m.data.outcome === 'waitlisted'
                ? `${r.team.name} is #${r.waitlistPosition} on the ${r.division.name} waitlist. The director will contact you if a spot opens.`
                : `The tournament director reviews registrations. ${r.team.name}'s spot in ${r.division.name} is held while they review it.`}
          </p>
          <p className="mt-2 text-sm text-ink-muted">A copy of your current roster was attached to this registration. Keep it up to date before the roster deadline{d.rosterLocksAt ? ` (${formatEasternStamp(d.rosterLocksAt)})` : ''}.</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <LinkButton to={`/dashboard/registrations/${r.id}`}>View registration</LinkButton>
            <LinkButton to={`/dashboard/teams/${r.team.id}/roster`} variant="secondary">Edit roster</LinkButton>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container-page max-w-2xl py-10">
      <PageHeader eyebrow={<Link to={`/tournaments/${slug}`} className="hover:underline">{d.title}</Link>} title="Register a team" description={formatDateRange(d.startsOn, d.endsOn)} />
      {d.registrationState !== 'open' ? (
        <Alert tone="warn" title={d.registrationState === 'not_yet_open' ? 'Registration has not opened yet' : 'Registration is closed'} />
      ) : teams.data?.length === 0 ? (
        <EmptyState title="Add a team first" action={<LinkButton to="/dashboard/teams/new">Add a team</LinkButton>}>You'll need a team (and ideally its roster) before registering.</EmptyState>
      ) : (
        <Card className="p-6">
          <form className="space-y-5" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
            {fullError ? (
              <Alert tone="warn" title={(m.error as ApiRequestError).message}>{(m.error as ApiRequestError).details?.waitlistAvailable && 'Check "Join the waitlist" below and submit again.'}</Alert>
            ) : (
              <FormError error={m.error} />
            )}
            <SelectField label="Team" required value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Choose a team</option>
              {teams.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.ageGroup})
                </option>
              ))}
            </SelectField>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Division</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {d.divisions.map((x) => (
                  <label key={x.id} className={cx('flex cursor-pointer items-start justify-between gap-2 rounded-xl border p-3', divisionId === x.id ? 'border-brand-navy ring-2 ring-brand-navy/20' : 'border-line-strong')}>
                    <span className="flex items-start gap-2">
                      <input type="radio" name="division" value={x.id} checked={divisionId === x.id} onChange={() => setDivisionId(x.id)} className="mt-1 accent-brand-navy" required />
                      <span>
                        <span className="block font-semibold">{x.name}</span>
                        <span className="text-xs text-ink-muted">{x.ageLabel}{x.classification ? ` · ${x.classification}` : ''}</span>
                      </span>
                    </span>
                    {x.spotsRemaining !== null && (x.isFull ? <Badge tone="warn">{x.waitlistAvailable ? 'Waitlist' : 'Full'}</Badge> : <Badge tone="ok">{x.spotsRemaining} left</Badge>)}
                  </label>
                ))}
              </div>
            </fieldset>
            {team && division && team.ageGroup !== division.ageLabel && (
              <Alert tone="warn" title={`${team.name} is listed as ${team.ageGroup}; this division is ${division.ageLabel}.`}>Eligibility is decided by the tournament director under the event rules.</Alert>
            )}
            {team && team.rosterCount === 0 && <Alert tone="info" title="This team has no roster yet">You can register now and add players before the roster deadline.</Alert>}
            {(division?.isFull || fullError) && division?.waitlistAvailable !== false && <Checkbox label="Join the waitlist if the division is full" checked={waitlist} onChange={(e) => setWaitlist(e.target.checked)} />}
            <Checkbox required label="I have read the event and division rules and confirm this team is eligible." checked={ack} onChange={(e) => setAck(e.target.checked)} />
            {d.feeInfo && <p className="text-sm text-ink-muted"><strong className="text-ink">Fees:</strong> {d.feeInfo} Payment arrangements are confirmed separately; submitting does not charge you.</p>}
            <Button type="submit" variant="flame" size="lg" loading={m.isPending} disabled={!teamId || !divisionId || !ack}>
              Submit registration
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

export function RegistrationsPage() {
  const regs = useMyRegistrations();
  return (
    <>
      <PageHeader title="Registrations" />
      {regs.isPending ? <SkeletonList /> : regs.isError ? <ErrorState error={regs.error} retry={() => regs.refetch()} /> : <RegistrationList regs={regs.data} />}
    </>
  );
}

export function RegistrationDetail() {
  const { registrationId = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-registration', registrationId], queryFn: () => api<RegistrationDto>(`/me/registrations/${registrationId}`) });
  const snaps = useQuery({ queryKey: ['my-registration', registrationId, 'snapshots'], queryFn: () => api<RosterSnapshotDto[]>(`/me/registrations/${registrationId}/snapshots`) });
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [reason, setReason] = useState('');
  const withdraw = useMutation({
    mutationFn: () => api(`/me/registrations/${registrationId}/withdraw`, { body: { version: q.data!.version, reason } }),
    onSuccess: () => {
      setWithdrawOpen(false);
      qc.invalidateQueries();
    },
  });
  const checkout = useMutation({ mutationFn: () => api<{ checkoutUrl: string }>(`/me/registrations/${registrationId}/checkout`, { body: {} }), onSuccess: (r) => (window.location.href = r.checkoutUrl) });
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const r = q.data;
  const locked = !!r.tournament.rosterLocksAt && new Date(r.tournament.rosterLocksAt) <= new Date();
  const canWithdraw = ['pending_review', 'confirmed', 'waitlisted'].includes(r.status);
  return (
    <>
      <PageHeader eyebrow={<Link to="/dashboard/registrations" className="hover:underline">Registrations</Link>} title={`${r.team.name} · ${r.division.name}`} description={<Link to={`/tournaments/${r.tournament.slug}`} className="hover:underline">{r.tournament.title} · {formatDateRange(r.tournament.startsOn, r.tournament.endsOn)}</Link>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">Reference</p>
                <p className="tabular font-display text-2xl font-bold text-brand-navy">{r.referenceCode}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <RegistrationBadge status={r.status} />
                <PaymentBadge status={r.paymentStatus} />
              </div>
            </div>
            {r.waitlistPosition && <p className="mt-3 text-sm text-ink-muted">Waitlist position: <strong className="text-ink">#{r.waitlistPosition}</strong></p>}
          </Card>
          <Card className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold uppercase">Submitted event roster</h2>
              {locked ? <Badge tone="warn">Locked {formatEasternStamp(r.tournament.rosterLocksAt!)}</Badge> : r.tournament.rosterLocksAt ? <Badge tone="info">Editable until {formatEasternStamp(r.tournament.rosterLocksAt)}</Badge> : null}
            </div>
            {locked && <Alert tone="warn" title="Roster editing is closed for this event" className="mb-3">Changes to your team roster no longer apply to this tournament. Contact the director for approved changes.</Alert>}
            {!r.latestSnapshot || r.latestSnapshot.entries.length === 0 ? (
              <p className="text-sm text-ink-muted">No players were on the roster when this was last updated. <Link to={`/dashboard/teams/${r.team.id}/roster`} className="font-semibold text-brand-navy underline">Add players</Link></p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Roster submitted to {r.tournament.title}</caption>
                <thead className="text-left text-xs uppercase tracking-wider text-ink-muted">
                  <tr>
                    <th scope="col" className="w-16 py-2">#</th>
                    <th scope="col" className="py-2">Player</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {r.latestSnapshot.entries.map((e, i) => (
                    <tr key={i}>
                      <td className="tabular py-2 font-semibold">{e.jerseyNumber}</td>
                      <td className="py-2">{e.playerName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {r.latestSnapshot && <p className="mt-3 text-xs text-ink-subtle">Revision {r.latestSnapshot.revision} · {formatEasternStamp(r.latestSnapshot.createdAt)}{r.latestSnapshot.reason ? ` · ${r.latestSnapshot.reason}` : ''}</p>}
            {snaps.data && snaps.data.length > 1 && <p className="text-xs text-ink-subtle">{snaps.data.length} revisions on file.</p>}
          </Card>
        </div>
        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="text-lg font-semibold uppercase">Status history</h2>
            <ol className="mt-3 space-y-3 border-l-2 border-line pl-4">
              {r.timeline.map((e, i) => (
                <li key={i} className="text-sm">
                  <RegistrationBadge status={e.to} />
                  <p className="mt-1 text-xs text-ink-subtle">{formatEasternStamp(e.at)}{e.byStaff ? ' · by tournament staff' : ''}</p>
                  {e.reason && <p className="mt-0.5 text-xs text-ink-muted">{e.reason}</p>}
                </li>
              ))}
            </ol>
          </Card>
          {['not_started', 'failed'].includes(r.paymentStatus) && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Payment</h2>
              <p className="mt-1 text-xs text-ink-muted">Online payment opens once your spot is held. Payment is only marked complete after the payment provider confirms it.</p>
              <FormError error={checkout.error} />
              <Button size="sm" className="mt-3" onClick={() => checkout.mutate()} loading={checkout.isPending}>Pay online</Button>
            </Card>
          )}
          {canWithdraw && (
            <Button variant="secondary" className="w-full" onClick={() => setWithdrawOpen(true)}>
              Withdraw from tournament
            </Button>
          )}
        </aside>
      </div>
      <Dialog open={withdrawOpen} onClose={() => setWithdrawOpen(false)} title="Withdraw registration" footer={<><Button variant="secondary" onClick={() => setWithdrawOpen(false)}>Keep registration</Button><Button variant="danger" onClick={() => withdraw.mutate()} loading={withdraw.isPending} disabled={!reason.trim()}>Withdraw</Button></>}>
        <p className="mb-4 text-sm text-ink-muted">Withdrawing releases {r.team.name}'s spot. Refunds follow the event's refund policy. This can't be undone online.</p>
        <FormError error={withdraw.error} />
        <TextArea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Dialog>
    </>
  );
}

// ---- Settings -------------------------------------------------------------------------------------

export function NotificationsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['prefs'], queryFn: () => api<{ emailRegistrationUpdates: boolean; emailEventNotices: boolean }>('/me/notification-preferences') });
  const m = useMutation({ mutationFn: (b: { emailRegistrationUpdates: boolean; emailEventNotices: boolean }) => api('/me/notification-preferences', { method: 'PUT', body: b }), onSuccess: () => qc.invalidateQueries({ queryKey: ['prefs'] }) });
  if (q.isPending) return <SkeletonList rows={1} />;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <>
      <PageHeader title="Notifications" description="Email is a convenience. The tournament's Updates page is always the source of truth." />
      <Card className="space-y-5 p-6">
        <FormError error={m.error} />
        <Checkbox label="Registration updates" hint="Confirmations, waitlist and status changes." checked={q.data.emailRegistrationUpdates} onChange={(e) => m.mutate({ ...q.data, emailRegistrationUpdates: e.target.checked })} />
        <Checkbox label="Game-day notices for my events" hint="Weather delays, field changes and cancellations for tournaments your teams are in." checked={q.data.emailEventNotices} onChange={(e) => m.mutate({ ...q.data, emailEventNotices: e.target.checked })} />
        <p className="text-xs text-ink-subtle">Text-message alerts aren't available yet.</p>
      </Card>
    </>
  );
}

export function ProfilePage() {
  const me = useMe();
  const { signOut } = useAuthActions();
  const nav = useNavigate();
  const [pw, setPw] = useState({ current: '', next: '' });
  const change = useMutation({ mutationFn: () => api('/auth/change-password', { body: { currentPassword: pw.current, newPassword: pw.next, revokeOtherSessions: true } }) });
  const [mfaPw, setMfaPw] = useState('');
  const [mfa, setMfa] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState('');
  const enable = useMutation({ mutationFn: () => api<{ totpURI: string; backupCodes: string[] }>('/auth/two-factor/enable', { body: { password: mfaPw } }), onSuccess: setMfa });
  const confirmMfa = useMutation({ mutationFn: () => api('/auth/two-factor/verify-totp', { body: { code } }), onSuccess: () => (setMfa(null), me.refetch()) });
  const u = me.data?.user;
  if (!u) return null;
  return (
    <>
      <PageHeader title="Account" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-lg font-semibold uppercase">Profile</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="text-ink-subtle">Name</dt><dd className="font-semibold">{u.name}</dd></div>
            <div><dt className="text-ink-subtle">Email</dt><dd className="font-semibold">{u.email}</dd></div>
          </dl>
          <Button variant="secondary" className="mt-5" onClick={async () => (await signOut(), nav('/'))}>
            <LogOut className="size-4" aria-hidden /> Sign out
          </Button>
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-semibold uppercase">Change password</h2>
          <form className="mt-4 space-y-4" onSubmit={(e) => (e.preventDefault(), change.mutate())}>
            {change.isSuccess ? <Alert tone="ok" title="Password changed. Other devices were signed out." /> : <FormError error={change.error} />}
            <TextField label="Current password" type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            <TextField label="New password" type="password" autoComplete="new-password" minLength={10} required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <Button type="submit" loading={change.isPending}>Update password</Button>
          </form>
        </Card>
        <Card className="p-6 xl:col-span-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold uppercase"><ShieldCheck className="size-5 text-ok" aria-hidden /> Two-factor authentication</h2>
          {u.twoFactorEnabled ? (
            <p className="mt-2 text-sm text-ok">Enabled. You'll be asked for a code when signing in.</p>
          ) : mfa ? (
            <div className="mt-3 space-y-4">
              <p className="text-sm text-ink-muted">Add this account to your authenticator app using the setup key below, then enter a code to finish.</p>
              <code className="block break-all rounded-lg bg-surface-sunk p-3 text-xs">{new URL(mfa.totpURI).searchParams.get('secret')}</code>
              <details className="text-sm"><summary className="cursor-pointer font-semibold">Backup codes (store safely)</summary><ul className="tabular mt-2 grid grid-cols-2 gap-1 font-mono text-xs">{mfa.backupCodes.map((c) => <li key={c}>{c}</li>)}</ul></details>
              <form className="flex items-end gap-2" onSubmit={(e) => (e.preventDefault(), confirmMfa.mutate())}>
                <TextField label="6-digit code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
                <Button type="submit" loading={confirmMfa.isPending}>Confirm</Button>
              </form>
              <FormError error={confirmMfa.error} />
            </div>
          ) : (
            <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => (e.preventDefault(), enable.mutate())}>
              <p className="w-full text-sm text-ink-muted">Recommended for everyone and required for tournament staff before launch.</p>
              <TextField label="Confirm password" type="password" autoComplete="current-password" value={mfaPw} onChange={(e) => setMfaPw(e.target.value)} />
              <Button type="submit" loading={enable.isPending}>Set up</Button>
              <div className="w-full"><FormError error={enable.error} /></div>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
