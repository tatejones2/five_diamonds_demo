import type { ImportPreview, ManagerTeam, RosterDto, RosterRules, RosterValidation } from '@fd/shared';
import { validateRoster } from '@fd/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Lock, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, Badge, Button, Card, cx, Dialog, ErrorState, FormError, LiveRegion, PageHeader, SkeletonList, TextArea } from '../../components/ui';
import { api, ApiRequestError } from '../../lib/api';
import { formatEasternStamp } from '../../lib/format';

type Row = { key: string; playerName: string; jerseyNumber: string };
let seq = 0;
const newRow = (p = '', j = ''): Row => ({ key: `r${seq++}`, playerName: p, jerseyNumber: j });

export default function RosterPage() {
  const { teamId = '' } = useParams();
  const qc = useQueryClient();
  const team = useQuery({ queryKey: ['my-team', teamId], queryFn: () => api<ManagerTeam>(`/me/teams/${teamId}`) });
  const roster = useQuery({ queryKey: ['roster', teamId], queryFn: () => api<RosterDto & { rules: RosterRules }>(`/me/teams/${teamId}/roster`) });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [announce, setAnnounce] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  useEffect(() => {
    if (roster.data && rows === null) setRows(roster.data.entries.map((e) => newRow(e.playerName, e.jerseyNumber)));
  }, [roster.data, rows]);

  const rules = roster.data?.rules ?? { maxSize: 40, allowDuplicateJersey: false };
  const validation: RosterValidation | null = useMemo(() => (rows ? validateRoster(rows, rules) : null), [rows, rules]);
  const dirty = useMemo(() => {
    if (!rows || !roster.data) return false;
    const a = rows.map((r) => `${r.playerName.trim()}|${r.jerseyNumber.trim()}`).join('\n');
    const b = roster.data.entries.map((e) => `${e.playerName}|${e.jerseyNumber}`).join('\n');
    return a !== b;
  }, [rows, roster.data]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => api<{ version: number; count: number; frozenRegistrations: { tournamentTitle: string }[]; warnings: string[] }>(`/me/teams/${teamId}/roster`, { method: 'PUT', body: { version: roster.data!.version, entries: rows!.map(({ playerName, jerseyNumber }) => ({ playerName, jerseyNumber })) } }),
    onSuccess: async (r) => {
      setAnnounce(`Roster saved with ${r.count} players.`);
      await qc.invalidateQueries({ queryKey: ['roster', teamId] });
      await qc.invalidateQueries({ queryKey: ['my-team', teamId] });
      setRows(null);
    },
  });

  if (roster.isPending || team.isPending || !rows) return <SkeletonList />;
  if (roster.isError) return <ErrorState error={roster.error} retry={() => roster.refetch()} />;
  if (team.isError) return <ErrorState error={team.error} />;

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const errorsFor = (i: number) => validation?.rows[i]?.errors ?? [];
  const versionConflict = save.error instanceof ApiRequestError && save.error.code === 'VERSION_CONFLICT';

  return (
    <>
      <PageHeader
        eyebrow={<Link to={`/dashboard/teams/${teamId}`} className="hover:underline">{team.data.name}</Link>}
        title="Roster"
        description="Player names and jersey numbers only. Rosters are private to you and authorized tournament staff."
        actions={
          <>
            <a href="/api/me/roster-template.csv" className="inline-flex h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-[15px] font-semibold text-ink hover:bg-surface-sunk">
              <Download className="size-4" aria-hidden /> Template
            </a>
            <ImportButton teamId={teamId} onPreview={setPreview} />
          </>
        }
      />
      <LiveRegion message={announce} />

      {roster.data.locks.length > 0 && (
        <Alert tone="warn" title="Roster locked for some events" className="mb-4">
          <ul className="mt-1 list-disc pl-5">
            {roster.data.locks.map((l) => (
              <li key={l.registrationId}>
                <Link to={`/dashboard/registrations/${l.registrationId}`} className="font-semibold text-brand-navy underline">{l.tournamentTitle}</Link> locked {formatEasternStamp(l.lockedAt)}. Changes here won't apply to that event; its submitted roster stays as it was.
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <Badge tone={rules.maxSize !== null && rows.length > rules.maxSize ? 'danger' : 'neutral'}>
              {rows.length}
              {rules.maxSize !== null ? ` / ${rules.maxSize}` : ''} players
            </Badge>
            {!rules.allowDuplicateJersey && <span className="text-xs text-ink-subtle">Jersey numbers must be unique</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPasteOpen(true)}>Bulk paste</Button>
            <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs!, newRow()])}>
              <Plus className="size-4" aria-hidden /> Add player
            </Button>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink-muted">No players yet. Add players one at a time, paste a list, or import a CSV/XLSX file.</div>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Roster for {team.data.name}</caption>
            <thead className="bg-surface-alt text-left text-xs uppercase tracking-wider text-ink-muted">
              <tr>
                <th scope="col" className="w-24 px-4 py-2">Jersey #</th>
                <th scope="col" className="px-2 py-2">Player name</th>
                <th scope="col" className="w-12 px-2 py-2"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => {
                const errs = errorsFor(i);
                const warn = validation?.rows[i]?.warnings ?? [];
                return (
                  <tr key={r.key} className={cx(errs.length > 0 && 'bg-danger-soft/40')}>
                    <td className="px-4 py-2 align-top">
                      <input aria-label={`Jersey number, row ${i + 1}`} inputMode="numeric" maxLength={3} value={r.jerseyNumber} onChange={(e) => update(r.key, { jerseyNumber: e.target.value })} className="tabular h-10 w-16 rounded-lg border border-line-strong px-2 text-center font-semibold focus:border-brand-sky focus:outline-none focus:ring-4 focus:ring-brand-sky/15" aria-invalid={errs.length > 0 || undefined} />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input aria-label={`Player name, row ${i + 1}`} value={r.playerName} onChange={(e) => update(r.key, { playerName: e.target.value })} autoComplete="off" className="h-10 w-full rounded-lg border border-line-strong px-3 focus:border-brand-sky focus:outline-none focus:ring-4 focus:ring-brand-sky/15" aria-invalid={errs.length > 0 || undefined} aria-describedby={errs.length || warn.length ? `row-msg-${r.key}` : undefined} />
                      {(errs.length > 0 || warn.length > 0) && (
                        <p id={`row-msg-${r.key}`} className={cx('mt-1 text-xs', errs.length ? 'text-danger' : 'text-warn')}>
                          {[...errs, ...warn].join(' ')}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <button type="button" onClick={() => setRows((rs) => rs!.filter((x) => x.key !== r.key))} className="inline-flex size-10 items-center justify-center rounded-lg text-ink-subtle hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${r.playerName || `row ${i + 1}`}`}>
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-alt px-4 py-3">
          <div className="text-sm">
            {validation && !validation.valid ? (
              <span className="font-semibold text-danger">{validation.errors[0] ?? 'Fix the highlighted rows before saving.'}</span>
            ) : dirty ? (
              <span className="text-ink-muted">Unsaved changes</span>
            ) : (
              <span className="text-ink-subtle">All changes saved</span>
            )}
          </div>
          <div className="flex gap-2">
            {dirty && <Button variant="ghost" onClick={() => setRows(null)}>Discard</Button>}
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || !validation?.valid}>Save roster</Button>
          </div>
        </div>
      </Card>
      <div className="mt-4">
        {versionConflict ? (
          <Alert tone="warn" title="This roster changed in another window or by staff.">
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => (setRows(null), save.reset(), roster.refetch())}>Reload latest roster</Button>
          </Alert>
        ) : (
          <FormError error={save.error} />
        )}
        {save.isSuccess && save.data.frozenRegistrations.length > 0 && (
          <Alert tone="info" title="Saved. Locked events were not changed." className="mt-3">
            {save.data.frozenRegistrations.map((f) => f.tournamentTitle).join(', ')} keep the roster submitted before the deadline.
          </Alert>
        )}
        {save.isSuccess && save.data.frozenRegistrations.length === 0 && <Alert tone="ok" title={`Roster saved (${save.data.count} players).`} className="mt-3" />}
      </div>

      <PasteDialog open={pasteOpen} onClose={() => setPasteOpen(false)} onApply={(parsed) => (setRows((rs) => [...rs!, ...parsed.map((p) => newRow(p.playerName, p.jerseyNumber))]), setPasteOpen(false))} />
      <ImportPreviewDialog
        preview={preview}
        onClose={() => setPreview(null)}
        onApply={(mode) => {
          const imported = preview!.validation.rows.map((r) => newRow(r.playerName, r.jerseyNumber));
          setRows((rs) => (mode === 'replace' ? imported : [...rs!, ...imported]));
          setPreview(null);
          setAnnounce(`${imported.length} rows added to the editor. Review and save.`);
        }}
      />
      <p className="mt-6 flex items-center gap-1.5 text-xs text-ink-subtle">
        <Lock className="size-3.5" aria-hidden /> We don't collect birth dates, addresses, medical or parent contact details.
      </p>
    </>
  );
}

function ImportButton({ teamId, onPreview }: { teamId: string; onPreview: (p: ImportPreview) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const m = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api<ImportPreview>(`/me/teams/${teamId}/roster/import-preview`, { form: fd });
    },
    onSuccess: onPreview,
  });
  return (
    <>
      <input ref={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => (e.target.files?.[0] && m.mutate(e.target.files[0]), (e.target.value = ''))} />
      <Button onClick={() => input.current?.click()} loading={m.isPending}>
        <FileUp className="size-4" aria-hidden /> Import file
      </Button>
      {m.error && (
        <div className="w-full">
          <FormError error={m.error} />
        </div>
      )}
    </>
  );
}

function ImportPreviewDialog({ preview, onClose, onApply }: { preview: ImportPreview | null; onClose: () => void; onApply: (mode: 'replace' | 'append') => void }) {
  const p = preview;
  const bad = p?.validation.rows.filter((r) => r.errors.length) ?? [];
  return (
    <Dialog
      open={!!p}
      onClose={onClose}
      title="Import preview"
      wide
      footer={
        p && p.fileErrors.length === 0 ? (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="secondary" onClick={() => onApply('append')}>Add to roster</Button>
            <Button onClick={() => onApply('replace')}>Replace roster</Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      {p && (
        <div className="space-y-4">
          {p.fileErrors.length > 0 ? (
            <Alert tone="danger" title="We couldn't read this file">
              <ul className="list-disc pl-5">{p.fileErrors.map((e) => <li key={e}>{e}</li>)}</ul>
              <p className="mt-2">Download the template for the expected columns.</p>
            </Alert>
          ) : (
            <>
              <p className="text-sm text-ink-muted">
                {p.validation.rows.length} rows found. {bad.length > 0 ? <strong className="text-danger">{bad.length} need fixing</strong> : 'All rows look good.'} Nothing is saved until you review the rows in the editor and choose Save.
              </p>
              {p.validation.errors.map((e) => <Alert key={e} tone="warn" title={e} />)}
              <div className="max-h-80 overflow-y-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-alt text-left text-xs uppercase text-ink-muted">
                    <tr><th className="px-3 py-2">File row</th><th className="px-3 py-2">#</th><th className="px-3 py-2">Player</th><th className="px-3 py-2">Issues</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {p.validation.rows.map((r) => (
                      <tr key={r.index} className={cx(r.errors.length && 'bg-danger-soft/50')}>
                        <td className="tabular px-3 py-2 text-ink-subtle">{r.sourceRow}</td>
                        <td className="tabular px-3 py-2 font-semibold">{r.jerseyNumber}</td>
                        <td className="px-3 py-2">{r.playerName || <em className="text-ink-subtle">blank</em>}</td>
                        <td className={cx('px-3 py-2 text-xs', r.errors.length ? 'text-danger' : 'text-warn')}>{[...r.errors, ...r.warnings].join(' ') || <span className="text-ok">OK</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

function PasteDialog({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (rows: { playerName: string; jerseyNumber: string }[]) => void }) {
  const [text, setText] = useState('');
  const parsed = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^#?(\d{1,2})[\s,\t-]+(.+)$/.exec(l) ?? /^(.+?)[\s,\t]+#?(\d{1,2})$/.exec(l);
      if (!m) return { playerName: l, jerseyNumber: '' };
      return /^\d/.test(m[1]!) ? { jerseyNumber: m[1]!, playerName: m[2]!.trim() } : { playerName: m[1]!.trim(), jerseyNumber: m[2]! };
    });
  return (
    <Dialog open={open} onClose={onClose} title="Bulk paste players" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => (onApply(parsed), setText(''))} disabled={!parsed.length}>Add {parsed.length || ''} players</Button></>}>
      <TextArea label="One player per line" hint='Formats: "7 Alex Smith", "Alex Smith, 7" or "Alex Smith<tab>7".' rows={10} value={text} onChange={(e) => setText(e.target.value)} />
    </Dialog>
  );
}
