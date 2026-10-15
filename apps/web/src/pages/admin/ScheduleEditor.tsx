import type { AdminGame, AdminRegistrationDto, ScheduleIssue } from '@fd/shared';
import { easternWallTimeToUtc, formatCalendarDate, STATUS_LABELS } from '@fd/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, LayoutGrid, List, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Badge, Button, Card, Checkbox, cx, Dialog, EmptyState, ErrorState, FormError, SelectField, SkeletonList, TextArea, TextField } from '../../components/ui';
import { api, ApiRequestError } from '../../lib/api';
import { formatEasternStamp, formatEasternTime } from '../../lib/format';
import { useAdminT, useVenues } from './AdminCore';

interface Preview {
  token: string;
  issues: ScheduleIssue[];
  canPublish: boolean;
  changes: { added: string[]; changed: string[]; removed: string[] };
  lastPublishedAt: string | null;
}

function daysBetween(start: string, end: string) {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  while (d <= e && out.length < 14) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function ScheduleEditor() {
  const t = useAdminT();
  const qc = useQueryClient();
  const games = useQuery({ queryKey: ['admin-games', t.id], queryFn: () => api<AdminGame[]>(`/admin/tournaments/${t.id}/games`) });
  const preview = useQuery({ queryKey: ['schedule-preview', t.id], queryFn: () => api<Preview>(`/admin/tournaments/${t.id}/schedule/validate`, { body: {} }) });
  const regs = useQuery({ queryKey: ['admin-regs', t.id, 'all'], queryFn: () => api<AdminRegistrationDto[]>(`/admin/tournaments/${t.id}/registrations`) });
  const venues = useVenues();
  const days = daysBetween(t.startsOn, t.endsOn);
  const [day, setDay] = useState(days[0]!);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [editing, setEditing] = useState<Partial<AdminGame> | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [slotCfg, setSlotCfg] = useState({ first: '08:00', last: '19:00', step: (t.divisions[0]?.defaultGameMinutes ?? 90) + t.fieldBufferMinutes });

  const fields = useMemo(() => (venues.data ?? []).filter((v) => t.venueIds.includes(v.id)).flatMap((v) => v.fields.filter((f) => f.isActive).map((f) => ({ ...f, label: `${v.name} · ${f.name}`, short: f.name }))), [venues.data, t.venueIds]);
  const teamsByDivision = useMemo(() => {
    const m = new Map<string, { id: string; name: string; status: string }[]>();
    for (const r of regs.data ?? []) if (['confirmed', 'pending_review', 'waitlisted'].includes(r.status)) m.set(r.division.id, [...(m.get(r.division.id) ?? []), { id: r.team.id, name: r.team.name, status: r.status }]);
    return m;
  }, [regs.data]);
  const teamName = (id: string | null) => (id ? ((regs.data ?? []).find((r) => r.team.id === id)?.team.name ?? 'Team') : null);
  const issuesByGame = useMemo(() => {
    const m = new Map<string, ScheduleIssue[]>();
    for (const i of preview.data?.issues ?? []) for (const g of i.gameIds) m.set(g, [...(m.get(g) ?? []), i]);
    return m;
  }, [preview.data]);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['admin-games', t.id] }), qc.invalidateQueries({ queryKey: ['schedule-preview', t.id] }), qc.invalidateQueries({ queryKey: ['admin-tournament', t.id] })]);
  const del = useMutation({ mutationFn: (g: AdminGame) => api(`/admin/tournaments/${t.id}/schedule/draft/${g.id}?version=${g.version}`, { method: 'DELETE' }), onSuccess: refresh });

  if (games.isPending || venues.isPending) return <SkeletonList />;
  if (games.isError) return <ErrorState error={games.error} retry={() => games.refetch()} />;
  if (fields.length === 0) {
    return <EmptyState title="Add venues and fields first" action={<Link to="/admin/venues" className="font-semibold text-brand-navy underline">Manage venues</Link>}>Attach at least one venue with fields to this tournament (Setup tab) before building the schedule.</EmptyState>;
  }

  const dayGames = games.data.filter((g) => g.date === day);
  const unscheduled = games.data.filter((g) => !g.date);
  // Rows = generated empty slots plus every actual start time, so each game sits on its own row label.
  const generated: string[] = [];
  for (let m = toMin(slotCfg.first); m <= toMin(slotCfg.last) && generated.length < 40; m += Math.max(15, Number(slotCfg.step) || 90)) generated.push(fromMin(m));
  const starts = dayGames.map((g) => g.time).filter((x): x is string => !!x);
  const slots = [...new Set([...generated.filter((g) => !starts.some((s) => Math.abs(toMin(s) - toMin(g)) < 30)), ...starts])].sort();
  const errors = preview.data?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = preview.data?.issues.filter((i) => i.severity === 'warning') ?? [];
  const pending = preview.data ? preview.data.changes.added.length + preview.data.changes.changed.length + preview.data.changes.removed.length : 0;

  const startNew = (over: Partial<AdminGame> = {}) => setEditing({ divisionId: t.divisions[0]?.id, stage: 'pool', durationMinutes: t.divisions[0]?.defaultGameMinutes ?? 90, date: day, time: '09:00', fieldId: fields[0]?.id ?? null, homeTeamId: null, awayTeamId: null, ...over });

  return (
    <div className="space-y-5">
      {/* Status bar */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {pending > 0 ? <Badge tone="warn">{pending} unpublished change{pending === 1 ? '' : 's'}</Badge> : <Badge tone="ok">Published schedule is current</Badge>}
          {errors.length > 0 && <span className="inline-flex items-center gap-1 font-semibold text-danger"><AlertTriangle className="size-4" aria-hidden /> {errors.length} error{errors.length === 1 ? '' : 's'}</span>}
          {warnings.length > 0 && <span className="text-warn">{warnings.length} warning{warnings.length === 1 ? '' : 's'}</span>}
          <span className="text-ink-subtle">{preview.data?.lastPublishedAt ? `Last published ${formatEasternStamp(preview.data.lastPublishedAt)}` : 'Never published'}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => startNew()}><Plus className="size-4" aria-hidden /> Add game</Button>
          <Button variant="flame" onClick={() => setPublishOpen(true)} disabled={pending === 0}><Send className="size-4" aria-hidden /> Preview & publish</Button>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Day" className="flex gap-2 overflow-x-auto">
          {days.map((d) => (
            <button key={d} role="tab" aria-selected={d === day} type="button" onClick={() => setDay(d)} className={cx('whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold', d === day ? 'bg-brand-navy text-white' : 'bg-surface text-ink-muted ring-1 ring-line')}>
              {formatCalendarDate(d, { weekday: 'short', month: 'short', day: 'numeric' })} <span>({games.data.filter((g) => g.date === d).length})</span>
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface p-1" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')} className={cx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold', view === 'board' ? 'bg-surface-sunk' : 'text-ink-muted')}><LayoutGrid className="size-4" aria-hidden /> Board</button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={cx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold', view === 'list' ? 'bg-surface-sunk' : 'text-ink-muted')}><List className="size-4" aria-hidden /> List</button>
        </div>
      </div>

      {view === 'board' ? (
        <>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-brand-navy">Time slot settings</summary>
            <div className="mt-3 grid max-w-xl grid-cols-3 gap-3">
              <TextField label="First start" type="time" value={slotCfg.first} onChange={(e) => setSlotCfg({ ...slotCfg, first: e.target.value })} />
              <TextField label="Last start" type="time" value={slotCfg.last} onChange={(e) => setSlotCfg({ ...slotCfg, last: e.target.value })} />
              <TextField label="Slot every (min)" type="number" min={15} value={slotCfg.step} onChange={(e) => setSlotCfg({ ...slotCfg, step: Number(e.target.value) })} hint="Game + turnaround" />
            </div>
          </details>
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface" role="region" aria-label={`Schedule board for ${day}`} tabIndex={0}>
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="bg-surface-alt">
                  <th scope="col" className="sticky left-0 z-10 w-20 bg-surface-alt px-3 py-2 text-left text-xs uppercase text-ink-muted">Time</th>
                  {fields.map((f) => <th key={f.id} scope="col" className="px-2 py-2 text-left text-xs font-semibold uppercase text-ink-muted">{f.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {slots.map((slot, si) => {
                  const next = slots[si + 1] ?? '23:59';
                  return (
                    <tr key={slot} className="border-t border-line align-top">
                      <th scope="row" className="tabular sticky left-0 z-10 bg-surface px-3 py-2 text-left font-semibold">{formatEasternTime(easternWallTimeToUtc(day, slot))}</th>
                      {fields.map((f) => {
                        const here = dayGames.filter((g) => g.fieldId === f.id && g.time! >= slot && g.time! < next);
                        return (
                          <td key={f.id} className="min-w-44 px-1.5 py-1.5">
                            {here.map((g) => <BoardGame key={g.id} g={g} issues={issuesByGame.get(g.id)} teamName={teamName} divisionName={t.divisions.find((d) => d.id === g.divisionId)?.name ?? ''} onEdit={() => setEditing(g)} />)}
                            {here.length === 0 && (
                              <button type="button" onClick={() => startNew({ fieldId: f.id, time: slot })} className="flex h-14 w-full items-center justify-center rounded-lg border border-dashed border-line text-ink-subtle hover:border-brand-sky hover:bg-brand-sky-soft hover:text-brand-navy" aria-label={`Add game on ${f.label} at ${slot}`}>
                                <Plus className="size-4" aria-hidden />
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {dayGames.some((g) => !slots.some((s, i) => g.time! >= s && g.time! < (slots[i + 1] ?? '23:59'))) && <Alert tone="info" title="Some games start outside the visible time slots. Use List view to see them." />}
        </>
      ) : (
        <GameList games={[...dayGames, ...unscheduled]} issuesByGame={issuesByGame} teamName={teamName} t={t} fields={fields} onEdit={setEditing} onDuplicate={(g) => startNew({ ...g, id: undefined, version: undefined, homeTeamId: null, awayTeamId: null, bracketMatchupId: null, stage: g.stage === 'bracket' ? 'pool' : g.stage })} onDelete={(g) => confirm('Remove this game from the draft?') && del.mutate(g)} />
      )}
      <FormError error={del.error} />

      {preview.data && preview.data.issues.length > 0 && <IssuesPanel issues={preview.data.issues} />}

      {editing && <GameDialog key={editing.id ?? 'new'} game={editing} onClose={() => setEditing(null)} onSaved={refresh} fields={fields} teamsByDivision={teamsByDivision} />}
      {publishOpen && preview.data && <PublishDialog preview={preview.data} onClose={() => setPublishOpen(false)} onPublished={refresh} />}
    </div>
  );
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function BoardGame({ g, issues, teamName, divisionName, onEdit }: { g: AdminGame; issues?: ScheduleIssue[]; teamName: (id: string | null) => string | null; divisionName: string; onEdit: () => void }) {
  const err = issues?.some((i) => i.severity === 'error');
  return (
    <button type="button" onClick={onEdit} className={cx('mb-1 block w-full rounded-lg border p-2 text-left text-xs transition hover:shadow-sm', err ? 'border-danger bg-danger-soft' : issues?.length ? 'border-warn bg-warn-soft' : g.stage === 'bracket' ? 'border-brand-flame/40 bg-brand-flame-soft' : 'border-brand-sky/40 bg-brand-sky-soft')}>
      <span className="flex items-center justify-between gap-1 font-semibold">
        <span className="tabular">{g.time ? formatEasternTime(g.startsAt!) : 'TBD'}</span>
        <span className="text-[10px] uppercase text-ink-muted">{divisionName}{g.poolLabel ? ` · ${g.poolLabel}` : ''}</span>
      </span>
      <span className="mt-0.5 block truncate">{teamName(g.awayTeamId) ?? g.awayPlaceholder ?? 'TBD'}</span>
      <span className="block truncate">@ {teamName(g.homeTeamId) ?? g.homePlaceholder ?? 'TBD'}</span>
      <span className="mt-1 flex flex-wrap gap-1">
        {!g.isPublished ? <span className="rounded bg-warn/15 px-1 text-[10px] font-bold uppercase text-warn">New</span> : g.hasUnpublishedChanges ? <span className="rounded bg-warn/15 px-1 text-[10px] font-bold uppercase text-warn">Edited</span> : null}
        {g.status !== 'scheduled' && <span className="rounded bg-ink/10 px-1 text-[10px] font-bold uppercase">{STATUS_LABELS.game[g.status]}</span>}
        {err && <span className="sr-only">Has schedule errors</span>}
      </span>
    </button>
  );
}

function GameList({ games, issuesByGame, teamName, t, fields, onEdit, onDuplicate, onDelete }: { games: AdminGame[]; issuesByGame: Map<string, ScheduleIssue[]>; teamName: (id: string | null) => string | null; t: ReturnType<typeof useAdminT>; fields: { id: string; label: string }[]; onEdit: (g: AdminGame) => void; onDuplicate: (g: AdminGame) => void; onDelete: (g: AdminGame) => void }) {
  if (games.length === 0) return <EmptyState title="No games on this day" />;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-surface-alt text-left text-xs uppercase tracking-wider text-ink-muted">
          <tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Field</th><th className="px-3 py-2">Division</th><th className="px-3 py-2">Matchup (away @ home)</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Checks</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {games.map((g) => {
            const iss = issuesByGame.get(g.id) ?? [];
            const name = g.label ?? `${g.startsAt ? formatEasternTime(g.startsAt) : 'unscheduled'} ${teamName(g.awayTeamId) ?? g.awayPlaceholder ?? 'TBD'} at ${teamName(g.homeTeamId) ?? g.homePlaceholder ?? 'TBD'}`;
            return (
              <tr key={g.id} className={cx(iss.some((i) => i.severity === 'error') && 'bg-danger-soft/40')}>
                <td className="tabular px-3 py-2 font-semibold">{g.startsAt ? formatEasternTime(g.startsAt) : 'TBD'}</td>
                <td className="px-3 py-2">{fields.find((f) => f.id === g.fieldId)?.label ?? '—'}</td>
                <td className="px-3 py-2">{t.divisions.find((d) => d.id === g.divisionId)?.name}{g.poolLabel ? ` · Pool ${g.poolLabel}` : ''}{g.stage === 'bracket' && <Badge tone="flame" className="ml-1">Bracket</Badge>}</td>
                <td className="px-3 py-2">{teamName(g.awayTeamId) ?? g.awayPlaceholder ?? 'TBD'} @ {teamName(g.homeTeamId) ?? g.homePlaceholder ?? 'TBD'}</td>
                <td className="px-3 py-2"><span className="text-xs">{STATUS_LABELS.game[g.status]}</span> {!g.isPublished ? <Badge tone="warn">New</Badge> : g.hasUnpublishedChanges ? <Badge tone="warn">Edited</Badge> : <Badge tone="ok">Live</Badge>}</td>
                <td className="px-3 py-2 text-xs">{iss.length ? iss.map((i) => <p key={i.code + i.message} className={i.severity === 'error' ? 'text-danger' : 'text-warn'}>{i.message}</p>) : <CheckCircle2 className="size-4 text-ok" aria-label="No issues" />}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => onEdit(g)} aria-label={`Edit ${name}`}><Pencil className="size-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => onDuplicate(g)} aria-label={`Duplicate ${name}`}><Copy className="size-4" /></Button>
                  {!g.bracketMatchupId && g.status !== 'final' && <Button size="sm" variant="ghost" onClick={() => onDelete(g)} aria-label={`Delete ${name}`}><Trash2 className="size-4" /></Button>}
                  {g.isPublished && <Link to={`/admin/games/${g.id}`} className="ml-1 text-xs font-semibold text-brand-navy underline">Game ops</Link>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function IssuesPanel({ issues }: { issues: ScheduleIssue[] }) {
  return (
    <Card className="p-4">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider">Schedule checks</h3>
      <ul className="space-y-1.5 text-sm">
        {issues.map((i, idx) => (
          <li key={idx} className={cx('flex gap-2', i.severity === 'error' ? 'text-danger' : 'text-warn')}>
            <span className="font-bold uppercase">{i.severity === 'error' ? 'Error' : 'Warning'}:</span> <span className="text-ink">{i.message}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GameDialog({ game, onClose, onSaved, fields, teamsByDivision }: { game: Partial<AdminGame>; onClose: () => void; onSaved: () => Promise<unknown>; fields: { id: string; label: string }[]; teamsByDivision: Map<string, { id: string; name: string; status: string }[]> }) {
  const t = useAdminT();
  const [f, setF] = useState({ ...game, homePlaceholder: game.homePlaceholder ?? '', awayPlaceholder: game.awayPlaceholder ?? '', poolLabel: game.poolLabel ?? '', label: game.label ?? '' });
  const isBracket = !!game.bracketMatchupId;
  const teams = teamsByDivision.get(f.divisionId ?? '') ?? [];
  const m = useMutation({
    mutationFn: () =>
      api<AdminGame>(`/admin/tournaments/${t.id}/schedule/draft`, {
        body: {
          id: game.id,
          version: game.version,
          divisionId: f.divisionId,
          stage: f.stage,
          poolLabel: f.poolLabel || null,
          label: f.label || null,
          fieldId: f.fieldId || null,
          date: f.date || null,
          time: f.time || null,
          durationMinutes: Number(f.durationMinutes),
          homeTeamId: f.homeTeamId || null,
          awayTeamId: f.awayTeamId || null,
          homePlaceholder: f.homeTeamId ? null : f.homePlaceholder || null,
          awayPlaceholder: f.awayTeamId ? null : f.awayPlaceholder || null,
        },
      }),
    onSuccess: async () => (await onSaved(), onClose()),
  });
  const fe = (k: string) => (m.error instanceof ApiRequestError ? m.error.fields[k] : undefined);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open onClose={onClose} wide title={game.id ? 'Edit game' : 'Add game'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Save to draft</Button></>}>
      <div className="space-y-4">
        <p className="text-xs text-ink-subtle">Saved changes stay in the draft until you publish. Times are Eastern.</p>
        <FormError error={m.error} />
        {isBracket && <Alert tone="info" title="Bracket game">Teams are filled from the bracket. Change seeds or overrides in the Brackets tab.</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label="Division" value={f.divisionId} onChange={(e) => setF({ ...f, divisionId: e.target.value, homeTeamId: null, awayTeamId: null })} disabled={isBracket} error={fe('divisionId')}>
            {t.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </SelectField>
          <SelectField label="Stage" value={f.stage} onChange={set('stage')} disabled={isBracket}>
            <option value="pool">Pool play</option>
            <option value="other">Other / exhibition</option>
            {isBracket && <option value="bracket">Bracket</option>}
          </SelectField>
          <TextField label="Pool" placeholder="A" value={f.poolLabel} onChange={set('poolLabel')} disabled={isBracket} />
          <TextField label="Date" type="date" value={f.date ?? ''} min={t.startsOn} max={t.endsOn} onChange={set('date')} />
          <TextField label="Start time (Eastern)" type="time" value={f.time ?? ''} onChange={set('time')} error={fe('time')} />
          <TextField label="Duration (min)" type="number" min={15} max={360} value={f.durationMinutes} onChange={set('durationMinutes')} />
        </div>
        <SelectField label="Field" value={f.fieldId ?? ''} onChange={set('fieldId')} error={fe('fieldId')}>
          <option value="">Unassigned</option>
          {fields.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          {(['awayTeamId', 'homeTeamId'] as const).map((k) => {
            const ph = k === 'homeTeamId' ? 'homePlaceholder' : 'awayPlaceholder';
            return (
              <div key={k} className="space-y-2 rounded-xl border border-line p-3">
                <SelectField label={k === 'homeTeamId' ? 'Home team' : 'Away team'} value={f[k] ?? ''} onChange={set(k)} disabled={isBracket} error={fe(k)}>
                  <option value="">Placeholder / TBD</option>
                  {teams.map((x) => <option key={x.id} value={x.id}>{x.name}{x.status !== 'confirmed' ? ` (${x.status.replace('_', ' ')})` : ''}</option>)}
                </SelectField>
                {!f[k] && <TextField label="Placeholder" placeholder="e.g. Pool A #1" value={(f as any)[ph]} onChange={set(ph)} disabled={isBracket} />}
              </div>
            );
          })}
        </div>
        {teams.some((x) => x.status !== 'confirmed') && <p className="text-xs text-warn">Only confirmed teams can be published. Pending or waitlisted teams will block publishing.</p>}
        <TextField label="Label" hint="Optional, e.g. “Game 7”" value={f.label} onChange={set('label')} />
      </div>
    </Dialog>
  );
}

function PublishDialog({ preview, onClose, onPublished }: { preview: Preview; onClose: () => void; onPublished: () => Promise<unknown> }) {
  const t = useAdminT();
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  const warnings = preview.issues.filter((i) => i.severity === 'warning');
  const errors = preview.issues.filter((i) => i.severity === 'error');
  const m = useMutation({ mutationFn: () => api<{ versionNumber: number }>(`/admin/tournaments/${t.id}/schedule/publish`, { body: { previewToken: preview.token, note: note || null, acknowledgeWarnings: ack } }), onSuccess: onPublished });
  if (m.isSuccess) {
    return (
      <Dialog open onClose={onClose} title="Schedule published" footer={<Button onClick={onClose}>Done</Button>}>
        <Alert tone="ok" title={`Version ${m.data.versionNumber} is live.`}>Parents and coaches now see the updated schedule. Consider posting a notice if times changed.</Alert>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} title="Review & publish schedule" footer={<><Button variant="secondary" onClick={onClose}>Back to editing</Button><Button variant="flame" onClick={() => m.mutate()} loading={m.isPending} disabled={errors.length > 0 || (warnings.length > 0 && !ack)}>Publish now</Button></>}>
      <div className="space-y-4">
        <ul className="grid grid-cols-3 gap-2 text-center">
          {[['Added', preview.changes.added.length], ['Changed', preview.changes.changed.length], ['Removed', preview.changes.removed.length]].map(([l, n]) => (
            <li key={l} className="rounded-lg bg-surface-alt p-3"><p className="tabular font-display text-2xl font-bold">{n}</p><p className="text-xs uppercase text-ink-muted">{l}</p></li>
          ))}
        </ul>
        {errors.length > 0 && <Alert tone="danger" title={`${errors.length} error${errors.length === 1 ? '' : 's'} must be fixed first`}><ul className="list-disc pl-5">{errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul></Alert>}
        {warnings.length > 0 && (
          <Alert tone="warn" title={`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}>
            <ul className="list-disc pl-5">{warnings.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
            <Checkbox className="mt-3" label="I've reviewed these warnings and want to publish anyway" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          </Alert>
        )}
        <FormError error={m.error} />
        <TextArea label="Change note (internal history)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Dialog>
  );
}
