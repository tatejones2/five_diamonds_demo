import type { AdminGame, AdminRegistrationDto, AnnouncementCategory, AnnouncementScope, AnnouncementSeverity, GameStatus, PublicAnnouncement } from '@fd/shared';
import { ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_SEVERITIES, easternDateKey, easternTimeKey, easternWallTimeToUtc, GAME_STATUSES, nextPowerOfTwo, STATUS_LABELS } from '@fd/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { AlertBanner } from '../../components/alerts';
import { GameStatusBadge } from '../../components/status';
import { Alert, Badge, Button, Card, Checkbox, cx, Dialog, EmptyState, ErrorState, FormError, PageHeader, SelectField, SkeletonList, TextArea, TextField } from '../../components/ui';
import { api, ApiRequestError } from '../../lib/api';
import { formatEasternStamp, formatEasternTime, formatEasternDay } from '../../lib/format';
import { useAdminT, useVenues } from './AdminCore';

// ---- Score entry -----------------------------------------------------------------------------------

interface GameDetail {
  game: AdminGame;
  homeTeamName: string | null;
  awayTeamName: string | null;
  fieldLabel: string | null;
  tournament: { id: string; title: string; slug: string };
  history: { id: string; kind: string; reason: string | null; createdAt: string; snapshot: { status: GameStatus; homeScore: number | null; awayScore: number | null } }[];
  canManage: boolean;
}

function Stepper({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div>
      <p className="mb-1.5 truncate text-sm font-semibold">{label}</p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="lg" className="!px-0 size-14" onClick={() => onChange(Math.max(0, (value ?? 0) - 1))} aria-label={`${label}: one fewer run`}><Minus className="size-5" /></Button>
        <input aria-label={`${label} runs`} inputMode="numeric" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Math.min(99, Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0)))} className="tabular h-14 w-20 rounded-xl border border-line-strong text-center font-display text-3xl font-bold focus:border-brand-sky focus:outline-none focus:ring-4 focus:ring-brand-sky/15" />
        <Button variant="secondary" size="lg" className="!px-0 size-14" onClick={() => onChange(Math.min(99, (value ?? 0) + 1))} aria-label={`${label}: one more run`}><Plus className="size-5" /></Button>
      </div>
    </div>
  );
}

export function GameOps() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-game', id], queryFn: () => api<GameDetail>(`/admin/games/${id}`) });
  const [draft, setDraft] = useState<Partial<AdminGame> & { reason?: string; moveDate?: string; moveTime?: string } | null>(null);
  const [conflict, setConflict] = useState<{ impacted: { gameId: string; label: string | null; status: string; homeScore: number | null; awayScore: number | null }[] } | null>(null);

  const save = useMutation({
    mutationFn: (resolution?: 'reset_downstream' | 'keep_downstream') => {
      const g = q.data!.game;
      const d = { ...g, ...draft };
      const moving = q.data!.canManage && (d.moveDate !== undefined || d.moveTime !== undefined || d.fieldId !== g.fieldId);
      return api<AdminGame>(`/admin/games/${id}`, {
        method: 'PATCH',
        body: {
          version: g.version,
          status: d.status,
          resultType: d.resultType,
          homeScore: d.homeScore,
          awayScore: d.awayScore,
          forfeitWinner: d.forfeitWinner,
          reason: d.reason || null,
          ...(moving ? { fieldId: d.fieldId, date: d.moveDate ?? g.date, time: d.moveTime ?? g.time } : {}),
          ...(resolution ? { downstreamResolution: resolution } : {}),
        },
      });
    },
    onSuccess: () => {
      setDraft(null);
      setConflict(null);
      qc.invalidateQueries({ queryKey: ['admin-game', id] });
      qc.invalidateQueries({ queryKey: ['admin-games'] });
      qc.invalidateQueries({ queryKey: ['admin-brackets'] });
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === 'DOWNSTREAM_CONFLICT') setConflict(e.details);
    },
  });

  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const g = q.data.game;
  const d = { ...g, ...draft };
  const wasFinal = g.status === 'final';
  const changed = !!draft && Object.keys(draft).length > 0;
  const isBracket = g.stage === 'bracket';
  const homeName = q.data.homeTeamName ?? g.homePlaceholder ?? 'Home';
  const awayName = q.data.awayTeamName ?? g.awayPlaceholder ?? 'Away';

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow={<Link to={`/admin/tournaments/${q.data.tournament.id}/schedule`} className="hover:underline">{q.data.tournament.title}</Link>} title={`${awayName} @ ${homeName}`} description={`${g.startsAt ? `${formatEasternDay(g.startsAt)} ${formatEasternTime(g.startsAt)}` : 'Time TBD'} · ${q.data.fieldLabel ?? 'Field TBD'} · ${g.label ?? (g.stage === 'bracket' ? 'Bracket' : g.poolLabel ? `Pool ${g.poolLabel}` : 'Pool play')}`} actions={<GameStatusBadge status={g.status} forfeit={g.resultType === 'forfeit'} />} />
      {!g.isPublished && <Alert tone="warn" title="This game isn't published yet" className="mb-4">Publish the schedule before entering results.</Alert>}
      <Card className="space-y-6 p-5 sm:p-6">
        <FormError error={conflict ? null : save.error} />
        <SelectField label="Game status" value={d.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as GameStatus })}>
          {GAME_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS.game[s]}</option>)}
        </SelectField>
        {d.status === 'final' && (
          <div role="radiogroup" aria-label="Result type" className="flex gap-2">
            {(['played', 'forfeit'] as const).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={d.resultType === r} onClick={() => setDraft({ ...draft, resultType: r })} className={cx('rounded-lg px-4 py-2 text-sm font-semibold ring-1', d.resultType === r ? 'bg-brand-navy text-white ring-brand-navy' : 'ring-line-strong')}>
                {r === 'played' ? 'Played' : 'Forfeit'}
              </button>
            ))}
          </div>
        )}
        {d.status === 'final' && d.resultType === 'forfeit' ? (
          <SelectField label="Winner by forfeit" value={d.forfeitWinner ?? ''} onChange={(e) => setDraft({ ...draft, forfeitWinner: (e.target.value || null) as 'home' | 'away' | null })}>
            <option value="">Choose winner</option>
            <option value="away">{awayName} (away)</option>
            <option value="home">{homeName} (home)</option>
          </SelectField>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            <Stepper label={`${awayName} (away)`} value={d.awayScore} onChange={(v) => setDraft({ ...draft, awayScore: v })} />
            <Stepper label={`${homeName} (home)`} value={d.homeScore} onChange={(v) => setDraft({ ...draft, homeScore: v })} />
          </div>
        )}
        {isBracket && <p className="text-xs text-ink-subtle">Bracket games can't end in a tie. The winner advances only when the game is marked Final.</p>}
        {q.data.canManage && <RescheduleFields g={g} draft={draft} setDraft={setDraft} />}
        {(wasFinal || draft?.moveDate !== undefined || draft?.moveTime !== undefined || d.status === 'canceled' || d.status === 'postponed') && (
          <TextArea label={wasFinal ? 'Reason for correcting a final result' : 'Reason (shown in history)'} required={wasFinal} rows={2} value={d.reason ?? ''} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
        )}
        {wasFinal && !q.data.canManage && <Alert tone="info" title="Final results can only be corrected by a tournament director." />}
        <div className="flex flex-wrap gap-2">
          <Button size="lg" variant={d.status === 'final' && !wasFinal ? 'flame' : 'primary'} onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!changed}>
            {d.status === 'final' && !wasFinal ? 'Finalize game' : wasFinal ? 'Save correction' : 'Save'}
          </Button>
          {changed && <Button variant="ghost" size="lg" onClick={() => setDraft(null)}>Discard</Button>}
        </div>
        {d.status === 'final' && !wasFinal && <p className="text-xs text-ink-subtle">Finalizing publishes the result immediately and, for bracket games, advances the winner.</p>}
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider">History</h2>
        <ol className="space-y-2 text-sm">
          {[...q.data.history].reverse().map((h) => (
            <li key={h.id} className="flex flex-wrap justify-between gap-2 border-b border-line pb-2">
              <span><Badge>{h.kind.replace('_', ' ')}</Badge> {STATUS_LABELS.game[h.snapshot.status]}{h.snapshot.homeScore !== null ? ` · ${h.snapshot.awayScore ?? '-'}–${h.snapshot.homeScore}` : ''}{h.reason ? ` · “${h.reason}”` : ''}</span>
              <span className="text-xs text-ink-subtle">{formatEasternStamp(h.createdAt)}</span>
            </li>
          ))}
        </ol>
      </Card>

      {q.data.canManage && <AssignScorekeeper gameId={g.id} />}

      <Dialog open={!!conflict} onClose={() => setConflict(null)} title="This change affects later bracket games" footer={<><Button variant="secondary" onClick={() => setConflict(null)}>Cancel</Button><Button variant="secondary" onClick={() => save.mutate('keep_downstream')} loading={save.isPending}>Keep later results</Button><Button variant="danger" onClick={() => save.mutate('reset_downstream')} loading={save.isPending}>Reset later games</Button></>}>
        <p className="text-sm text-ink-muted">The winner of this game changes. These games already have results based on the previous winner:</p>
        <ul className="my-3 space-y-1 text-sm">
          {conflict?.impacted.map((i) => <li key={i.gameId} className="rounded-lg bg-surface-alt px-3 py-2"><strong>{i.label ?? 'Game'}</strong> · {i.status}{i.homeScore !== null ? ` · ${i.awayScore}–${i.homeScore}` : ''}</li>)}
        </ul>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li><strong className="text-ink">Reset later games</strong> clears their scores and advances the corrected winner. Those games must be replayed or re-entered.</li>
          <li><strong className="text-ink">Keep later results</strong> leaves them as played and records a director override.</li>
        </ul>
        <FormError error={save.error instanceof ApiRequestError && save.error.code !== 'DOWNSTREAM_CONFLICT' ? save.error : null} />
        <p className="mt-3 text-xs text-ink-subtle">Both choices are logged with your reason.</p>
      </Dialog>
    </div>
  );
}

function RescheduleFields({ g, draft, setDraft }: { g: AdminGame; draft: any; setDraft: (d: any) => void }) {
  const t = useQuery({ queryKey: ['admin-venues'], queryFn: () => api<{ id: string; name: string; fields: { id: string; name: string }[] }[]>('/admin/venues') });
  const fields = (t.data ?? []).flatMap((v) => v.fields.map((f) => ({ id: f.id, label: `${v.name} · ${f.name}` })));
  return (
    <details className="rounded-xl border border-line p-4">
      <summary className="cursor-pointer text-sm font-semibold">Move or delay this game</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <TextField label="Date" type="date" value={draft?.moveDate ?? g.date ?? ''} onChange={(e) => setDraft({ ...draft, moveDate: e.target.value })} />
        <TextField label="Time (Eastern)" type="time" value={draft?.moveTime ?? g.time ?? ''} onChange={(e) => setDraft({ ...draft, moveTime: e.target.value })} />
        <SelectField label="Field" value={draft?.fieldId ?? g.fieldId ?? ''} onChange={(e) => setDraft({ ...draft, fieldId: e.target.value })}>
          {fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </SelectField>
      </div>
      <p className="mt-2 text-xs text-ink-subtle">Moves of published games go live immediately after a conflict check. Post a notice so families know.</p>
    </details>
  );
}

export function MyGames() {
  const q = useQuery({ queryKey: ['my-staff-games'], queryFn: () => api<AdminGame[]>('/admin/my-games'), refetchInterval: 30_000 });
  return (
    <>
      <PageHeader title="Score entry" description="Published games you're allowed to score. Scorekeepers see only assigned games." />
      {q.isPending ? <SkeletonList /> : q.isError ? <ErrorState error={q.error} retry={() => q.refetch()} /> : q.data.length === 0 ? <EmptyState title="No games assigned">A tournament director assigns scorekeepers to games.</EmptyState> : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.map((g) => (
            <li key={g.id} className="card relative p-4 hover:shadow-[var(--shadow-lift)]">
              <div className="flex justify-between gap-2">
                <Link to={`/admin/games/${g.id}`} className="font-display text-lg font-semibold after:absolute after:inset-0">{g.startsAt ? `${formatEasternDay(g.startsAt)} ${formatEasternTime(g.startsAt)}` : 'TBD'}</Link>
                <GameStatusBadge status={g.status} />
              </div>
              <p className="text-sm text-ink-muted">{g.label ?? (g.poolLabel ? `Pool ${g.poolLabel}` : g.stage)}</p>
              {g.homeScore !== null && <p className="tabular mt-1 font-semibold">{g.awayScore}–{g.homeScore}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---- Brackets admin --------------------------------------------------------------------------------

interface AdminBracket {
  id: string;
  divisionId: string;
  divisionName: string;
  name: string;
  size: number;
  entrants: number;
  status: string;
  version: number;
  rounds: { round: number; name: string }[];
  matchups: { id: string; round: number; position: number; gameId: string | null; winnerSlot: 'top' | 'bottom' | null; game: AdminGame | null; slots: { id: string; position: string; seed: number | null; isBye: boolean; team: { id: string; name: string } | null; placeholder: string }[] }[];
}

export function BracketAdmin() {
  const t = useAdminT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-brackets', t.id], queryFn: () => api<AdminBracket[]>(`/admin/tournaments/${t.id}/brackets`) });
  const [creating, setCreating] = useState(false);
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold uppercase">Brackets</h2>
          <p className="text-sm text-ink-muted">Single elimination with seeding and byes. Other formats (double elimination, consolation) are not supported yet.</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New bracket</Button>
      </div>
      {q.data.length === 0 ? <EmptyState icon={<Trophy className="size-6" />} title="No brackets yet" /> : q.data.map((b) => <BracketEditorCard key={b.id} b={b} onChange={() => qc.invalidateQueries({ queryKey: ['admin-brackets', t.id] })} />)}
      {creating && <CreateBracketDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateBracketDialog({ onClose }: { onClose: () => void }) {
  const t = useAdminT();
  const qc = useQueryClient();
  const [f, setF] = useState({ divisionId: t.divisions[0]?.id ?? '', name: 'Championship Bracket', entrants: 4 });
  const size = nextPowerOfTwo(Math.max(2, f.entrants));
  const m = useMutation({ mutationFn: () => api(`/admin/tournaments/${t.id}/brackets`, { body: { ...f, entrants: Number(f.entrants), size } }), onSuccess: () => (qc.invalidateQueries({ queryKey: ['admin-brackets', t.id] }), onClose()) });
  return (
    <Dialog open onClose={onClose} title="New single-elimination bracket" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Create</Button></>}>
      <div className="space-y-4">
        <FormError error={m.error} />
        <SelectField label="Division" value={f.divisionId} onChange={(e) => setF({ ...f, divisionId: e.target.value })}>{t.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</SelectField>
        <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <TextField label="Number of teams" type="number" min={2} max={64} value={f.entrants} onChange={(e) => setF({ ...f, entrants: Number(e.target.value) })} hint={`${size}-team draw${size > f.entrants ? ` with ${size - f.entrants} bye${size - f.entrants === 1 ? '' : 's'} for the top seeds` : ''}.`} />
      </div>
    </Dialog>
  );
}

function BracketEditorCard({ b, onChange }: { b: AdminBracket; onChange: () => void }) {
  const t = useAdminT();
  const regs = useQuery({ queryKey: ['admin-regs', t.id, 'confirmed', b.divisionId], queryFn: () => api<AdminRegistrationDto[]>(`/admin/tournaments/${t.id}/registrations?status=confirmed&divisionId=${b.divisionId}`) });
  const venues = useVenues();
  const fields = (venues.data ?? []).filter((v) => t.venueIds.includes(v.id)).flatMap((v) => v.fields.map((f) => ({ id: f.id, label: `${v.name} · ${f.name}` })));
  const r1 = b.matchups.filter((m) => m.round === 1);
  const seededNow = new Map<number, string>();
  for (const m of r1) for (const s of m.slots) if (s.seed && s.team) seededNow.set(s.seed, s.team.id);
  const [seeds, setSeeds] = useState<Record<number, string>>(() => Object.fromEntries(Array.from({ length: b.entrants }, (_, i) => [i + 1, seededNow.get(i + 1) ?? ''])));
  const [reason, setReason] = useState('');
  const [sched, setSched] = useState<AdminBracket['matchups'][number] | null>(null);
  const saveSeeds = useMutation({ mutationFn: () => api(`/admin/brackets/${b.id}/seeds`, { body: { version: b.version, seeds: Object.entries(seeds).map(([seed, teamId]) => ({ seed: Number(seed), teamId: teamId || null })), reason: reason || null } }), onSuccess: onChange });
  const publish = useMutation({ mutationFn: () => api(`/admin/brackets/${b.id}/publish`, { body: { version: b.version } }), onSuccess: onChange });
  const anyStarted = b.matchups.some((m) => m.game && (m.game.status === 'final' || m.game.status === 'in_progress'));
  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{b.divisionName}</p>
          <h3 className="text-xl font-semibold uppercase">{b.name}</h3>
          <p className="text-sm text-ink-muted">{b.entrants} teams · {b.size}-team draw · {b.rounds.map((r) => r.name).join(' → ')}</p>
        </div>
        <div className="flex items-center gap-2">
          {b.status === 'published' ? <Badge tone="ok">Published</Badge> : <Badge>Draft</Badge>}
          {b.status !== 'published' && <Button size="sm" variant="flame" onClick={() => publish.mutate()} loading={publish.isPending}>Publish bracket</Button>}
        </div>
      </div>
      <FormError error={publish.error} />
      <div className="mt-5 grid gap-6 xl:grid-cols-[320px_1fr]">
        <div>
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider">Seeding</h4>
          <p className="mb-3 text-xs text-ink-subtle">Set seeds manually. Standings are {t.divisions.find((d) => d.id === b.divisionId)?.standingsSignedOff ? 'official for this division.' : 'unofficial, so seeds are your call.'}</p>
          {anyStarted && <Alert tone="info" title="Seeds are locked after games start." className="mb-3" />}
          <ol className="space-y-2">
            {Array.from({ length: b.entrants }, (_, i) => i + 1).map((seed) => (
              <li key={seed} className="flex items-center gap-2">
                <span className="tabular w-8 text-right font-display font-semibold text-ink-muted">{seed}</span>
                <select aria-label={`Seed ${seed}`} disabled={anyStarted} value={seeds[seed] ?? ''} onChange={(e) => setSeeds({ ...seeds, [seed]: e.target.value })} className="h-10 flex-1 rounded-lg border border-line-strong bg-surface px-2 text-sm disabled:bg-surface-sunk disabled:text-ink-muted">
                  <option value="">— Unassigned —</option>
                  {regs.data?.map((r) => <option key={r.team.id} value={r.team.id} disabled={Object.entries(seeds).some(([s, v]) => v === r.team.id && Number(s) !== seed)}>{r.team.name}</option>)}
                </select>
              </li>
            ))}
          </ol>
          {b.status === 'published' && !anyStarted && <TextField className="mt-3" label="Reason for changing seeds" value={reason} onChange={(e) => setReason(e.target.value)} />}
          <FormError error={saveSeeds.error} />
          {!anyStarted && <Button size="sm" className="mt-3" onClick={() => saveSeeds.mutate()} loading={saveSeeds.isPending}>Save seeds</Button>}
        </div>
        <div className="space-y-4 overflow-x-auto">
          {b.rounds.map((r) => (
            <div key={r.round}>
              <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider">{r.name}</h4>
              <ul className="grid gap-2 sm:grid-cols-2">
                {b.matchups.filter((m) => m.round === r.round).map((m) => {
                  const bye = m.slots.some((s) => s.isBye);
                  return (
                    <li key={m.id} className="rounded-lg border border-line">
                      {m.slots.map((s, i) => (
                        <div key={s.id} className={cx('flex items-center justify-between px-3 py-1.5 text-sm', i === 0 && 'border-b border-line', m.winnerSlot === s.position && 'bg-brand-sky-soft font-semibold')}>
                          <span className="truncate">{s.seed ? <span className="mr-1 text-xs text-ink-subtle">{s.seed}</span> : null}{s.team?.name ?? <em className="text-ink-subtle">{s.isBye ? 'Bye' : s.placeholder}</em>}</span>
                          {m.game && m.game.homeScore !== null && <span className="tabular">{i === 0 ? m.game.homeScore : m.game.awayScore}</span>}
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-2 bg-surface-alt px-3 py-1.5 text-xs">
                        {bye ? <span className="text-ink-subtle">Bye — auto-advances</span> : m.game ? (
                          <>
                            <span>{m.game.startsAt ? `${formatEasternDay(m.game.startsAt)} ${formatEasternTime(m.game.startsAt)}` : 'Unscheduled'} {!m.game.isPublished && <Badge tone="warn">Unpublished</Badge>}</span>
                            <span className="flex gap-2">
                              <button type="button" className="font-semibold text-brand-navy underline" onClick={() => setSched(m)}>Reschedule</button>
                              {m.game.isPublished && <Link to={`/admin/games/${m.game.id}`} className="font-semibold text-brand-navy underline">Score</Link>}
                            </span>
                          </>
                        ) : <button type="button" className="font-semibold text-brand-navy underline" onClick={() => setSched(m)}>Schedule game</button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="text-xs text-ink-subtle">Scheduled bracket games appear in the Schedule tab and go public when you publish the schedule.</p>
        </div>
      </div>
      {sched && <ScheduleMatchupDialog b={b} m={sched} fields={fields} onClose={() => setSched(null)} onDone={onChange} />}
    </Card>
  );
}

function ScheduleMatchupDialog({ b, m, fields, onClose, onDone }: { b: AdminBracket; m: AdminBracket['matchups'][number]; fields: { id: string; label: string }[]; onClose: () => void; onDone: () => void }) {
  const t = useAdminT();
  const qc = useQueryClient();
  const [f, setF] = useState({ fieldId: m.game?.fieldId ?? fields[0]?.id ?? '', date: m.game?.date ?? t.endsOn, time: m.game?.time ?? '12:00', durationMinutes: m.game?.durationMinutes ?? t.divisions.find((d) => d.id === b.divisionId)?.defaultGameMinutes ?? 90 });
  const mut = useMutation({ mutationFn: () => api(`/admin/brackets/${b.id}/schedule-matchup`, { body: { version: b.version, matchupId: m.id, ...f, durationMinutes: Number(f.durationMinutes) } }), onSuccess: () => (onDone(), qc.invalidateQueries({ queryKey: ['schedule-preview', t.id] }), onClose()) });
  return (
    <Dialog open onClose={onClose} title="Schedule bracket game" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => mut.mutate()} loading={mut.isPending}>Save to draft schedule</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormError error={mut.error} />
        <SelectField label="Field" className="sm:col-span-2" value={f.fieldId} onChange={(e) => setF({ ...f, fieldId: e.target.value })}>{fields.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</SelectField>
        <TextField label="Date" type="date" value={f.date} min={t.startsOn} max={t.endsOn} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <TextField label="Time (Eastern)" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
        <TextField label="Duration (min)" type="number" value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })} />
      </div>
    </Dialog>
  );
}

// ---- Notices -----------------------------------------------------------------------------------------

export function NoticesAdmin() {
  const t = useAdminT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-notices', t.id], queryFn: () => api<(PublicAnnouncement & { version: number })[]>(`/admin/announcements?tournamentId=${t.id}`) });
  const [composing, setComposing] = useState(false);
  const act = useMutation({ mutationFn: (v: { a: PublicAnnouncement & { version: number }; action: 'publish' | 'all_clear' | 'withdraw'; message?: string | null }) => api(`/admin/announcements/${v.a.id}/action`, { body: { version: v.a.version, action: v.action, message: v.message ?? null } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-notices', t.id] }) });
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold uppercase">Notices</h2>
        <Button variant="flame" onClick={() => setComposing(true)}><Plus className="size-4" aria-hidden /> New notice</Button>
      </div>
      <FormError error={act.error} />
      {q.isPending ? <SkeletonList /> : q.isError ? <ErrorState error={q.error} /> : q.data.length === 0 ? <EmptyState title="No notices">Post weather delays, field closures and schedule changes here. They appear on public pages immediately when published.</EmptyState> : (
        <ul className="space-y-3">
          {q.data.map((a) => (
            <li key={a.id} className="card p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <Badge tone={a.status === 'published' ? 'ok' : a.status === 'draft' ? 'neutral' : a.status === 'all_clear' ? 'info' : 'neutral'}>{a.status.replace('_', ' ')}</Badge>
                <div className="flex gap-2">
                  {a.status === 'draft' && <Button size="sm" variant="flame" onClick={() => act.mutate({ a, action: 'publish' })}>Publish</Button>}
                  {a.status === 'published' && <Button size="sm" onClick={() => { const m = prompt('All-clear message', 'All clear. Play resumes as scheduled.'); if (m !== null) act.mutate({ a, action: 'all_clear', message: m }); }}>All clear</Button>}
                  {a.status !== 'withdrawn' && <Button size="sm" variant="ghost" onClick={() => { const m = a.status === 'draft' ? '' : prompt('Reason for withdrawing'); if (m !== null) act.mutate({ a, action: 'withdraw', message: m || null }); }}>Withdraw</Button>}
                </div>
              </div>
              <AlertBanner a={a} />
            </li>
          ))}
        </ul>
      )}
      {composing && <NoticeDialog onClose={() => setComposing(false)} />}
    </>
  );
}

function NoticeDialog({ onClose }: { onClose: () => void }) {
  const t = useAdminT();
  const qc = useQueryClient();
  const venues = useVenues();
  const games = useQuery({ queryKey: ['admin-games', t.id], queryFn: () => api<AdminGame[]>(`/admin/tournaments/${t.id}/games`) });
  const [f, setF] = useState({ scope: 'tournament' as AnnouncementScope, scopeId: '', severity: 'advisory' as AnnouncementSeverity, category: 'weather_delay' as AnnouncementCategory, title: '', body: '', expires: '', affected: [] as string[], publishNow: true });
  const fields = (venues.data ?? []).filter((v) => t.venueIds.includes(v.id)).flatMap((v) => v.fields.map((x) => ({ id: x.id, label: `${v.name} · ${x.name}` })));
  const scopeOptions: Record<string, { id: string; label: string }[]> = {
    division: t.divisions.map((d) => ({ id: d.id, label: d.name })),
    venue: (venues.data ?? []).filter((v) => t.venueIds.includes(v.id)).map((v) => ({ id: v.id, label: v.name })),
    field: fields,
    game: (games.data ?? []).filter((g) => g.isPublished).map((g) => ({ id: g.id, label: `${g.startsAt ? formatEasternTime(g.startsAt) : 'TBD'} ${g.label ?? ''}` })),
  };
  const m = useMutation({
    mutationFn: async () => {
      const expiresAt = f.expires ? easternWallTimeToUtc(f.expires.slice(0, 10), f.expires.slice(11, 16)).toISOString() : null;
      const a = await api<{ id: string; version: number }>('/admin/announcements', { body: { tournamentId: t.id, scope: f.scope, scopeId: f.scope === 'tournament' ? null : f.scopeId || null, severity: f.severity, category: f.category, title: f.title, body: f.body, expiresAt, affectedGameIds: f.affected } });
      if (f.publishNow) await api(`/admin/announcements/${a.id}/action`, { body: { version: a.version, action: 'publish' } });
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['admin-notices', t.id] }), onClose()),
  });
  const fe = (k: string) => (m.error instanceof ApiRequestError ? m.error.fields[k] : undefined);
  const todays = (games.data ?? []).filter((g) => g.isPublished && g.startsAt && easternDateKey(g.startsAt) >= easternDateKey(new Date()));
  void easternTimeKey;
  return (
    <Dialog open onClose={onClose} wide title="New notice" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={f.publishNow ? 'flame' : 'primary'} onClick={() => m.mutate()} loading={m.isPending}>{f.publishNow ? 'Publish notice' : 'Save draft'}</Button></>}>
      <div className="space-y-4">
        <FormError error={m.error} />
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label="Severity" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as AnnouncementSeverity })}>{ANNOUNCEMENT_SEVERITIES.map((s) => <option key={s} value={s}>{s === 'critical' ? 'Critical (alert banner)' : s === 'advisory' ? 'Advisory' : 'Information'}</option>)}</SelectField>
          <SelectField label="Type" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as AnnouncementCategory })}>{ANNOUNCEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</SelectField>
          <SelectField label="Applies to" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as AnnouncementScope, scopeId: '' })}>
            {(['tournament', 'division', 'venue', 'field', 'game'] as const).map((s) => <option key={s} value={s}>{s === 'tournament' ? 'Whole tournament' : s[0]!.toUpperCase() + s.slice(1)}</option>)}
          </SelectField>
        </div>
        {f.scope !== 'tournament' && (
          <SelectField label={`Which ${f.scope}`} value={f.scopeId} onChange={(e) => setF({ ...f, scopeId: e.target.value })} error={fe('scopeId')}>
            <option value="">Choose…</option>
            {scopeOptions[f.scope]?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </SelectField>
        )}
        <TextField label="Headline" required maxLength={120} placeholder="Lightning delay — all fields" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} error={fe('title')} />
        <TextArea label="Details" required rows={4} placeholder="What's happening, what families should do, and when the next update is expected." value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} error={fe('body')} />
        <TextField label="Expires (Eastern, optional)" type="datetime-local" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} />
        {todays.length > 0 && (
          <fieldset className="rounded-xl border border-line p-3">
            <legend className="px-1 text-sm font-semibold">Affected games (highlighted on schedules)</legend>
            <div className="grid max-h-44 gap-1 overflow-y-auto sm:grid-cols-2">
              {todays.map((g) => <Checkbox key={g.id} label={`${formatEasternDay(g.startsAt!)} ${formatEasternTime(g.startsAt!)} ${g.label ?? (g.poolLabel ? `Pool ${g.poolLabel}` : '')}`} checked={f.affected.includes(g.id)} onChange={(e) => setF({ ...f, affected: e.target.checked ? [...f.affected, g.id] : f.affected.filter((x) => x !== g.id) })} />)}
            </div>
          </fieldset>
        )}
        <Checkbox label="Publish immediately" hint="Opted-in managers with teams in this tournament also get an email." checked={f.publishNow} onChange={(e) => setF({ ...f, publishNow: e.target.checked })} />
      </div>
    </Dialog>
  );
}

function AssignScorekeeper({ gameId }: { gameId: string }) {
  const [email, setEmail] = useState('');
  const m = useMutation({ mutationFn: () => api('/admin/game-assignments', { body: { email, gameIds: [gameId] } }), onSuccess: () => setEmail('') });
  return (
    <Card className="mt-6 p-5">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider">Assign a scorekeeper</h2>
      <p className="mb-3 text-xs text-ink-subtle">The person needs the Scorekeeper role for this tournament (granted under Staff & roles). They can then score only assigned games.</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
        <TextField label="Scorekeeper email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={m.error instanceof ApiRequestError ? m.error.fields.email : undefined} />
        <Button type="submit" loading={m.isPending}>Assign</Button>
      </form>
      {m.isSuccess && <Alert tone="ok" title="Assigned" className="mt-3" />}
    </Card>
  );
}
