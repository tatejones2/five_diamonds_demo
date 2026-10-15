import type { AdminRegistrationDto, PaymentStatus, RegistrationStatus, RosterSnapshotDto } from '@fd/shared';
import { PAYMENT_STATUSES, REGISTRATION_STATUSES, REGISTRATION_TRANSITIONS, STATUS_LABELS } from '@fd/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye } from 'lucide-react';
import { useState } from 'react';
import { PaymentBadge, RegistrationBadge } from '../../components/status';
import { Alert, Button, Card, Checkbox, Dialog, EmptyState, ErrorState, FormError, SelectField, SkeletonList, TextArea, TextField } from '../../components/ui';
import { api, ApiRequestError } from '../../lib/api';
import { formatEasternStamp } from '../../lib/format';
import { useAdminT } from './AdminCore';

export function AdminRegistrations() {
  const t = useAdminT();
  const [status, setStatus] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [q, setQ] = useState('');
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (divisionId) qs.set('divisionId', divisionId);
  if (q) qs.set('q', q);
  const list = useQuery({ queryKey: ['admin-regs', t.id, qs.toString()], queryFn: () => api<AdminRegistrationDto[]>(`/admin/tournaments/${t.id}/registrations?${qs}`), placeholderData: keepPreviousData });
  const [action, setAction] = useState<{ r: AdminRegistrationDto; kind: 'status' | 'payment' | 'roster' } | null>(null);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-semibold uppercase">Registrations</h2>
        <a href={`/api/admin/tournaments/${t.id}/registrations.csv?${qs}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold hover:bg-surface-sunk">
          <Download className="size-4" aria-hidden /> Export CSV
        </a>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <TextField label="Search" placeholder="Team, reference or manager email" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {REGISTRATION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS.registration[s]}</option>)}
        </SelectField>
        <SelectField label="Division" value={divisionId} onChange={(e) => setDivisionId(e.target.value)}>
          <option value="">All divisions</option>
          {t.divisions.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.heldSpots}/{d.capacity})</option>)}
        </SelectField>
      </div>
      {list.isPending ? <SkeletonList /> : list.isError ? <ErrorState error={list.error} retry={() => list.refetch()} /> : list.data.length === 0 ? <EmptyState title="No registrations match" /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-surface-alt text-left text-xs uppercase tracking-wider text-ink-muted">
              <tr><th className="px-4 py-2.5">Team</th><th className="px-4 py-2.5">Division</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Payment</th><th className="px-4 py-2.5">Manager</th><th className="px-4 py-2.5">Roster</th><th className="px-4 py-2.5"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3"><p className="font-semibold">{r.team.name}</p><p className="tabular text-xs text-ink-subtle">{r.referenceCode} · {formatEasternStamp(r.createdAt)}</p></td>
                  <td className="px-4 py-3">{r.division.name}</td>
                  <td className="px-4 py-3"><RegistrationBadge status={r.status} />{r.waitlistPosition && <p className="mt-1 text-xs text-ink-subtle">#{r.waitlistPosition} on waitlist</p>}</td>
                  <td className="px-4 py-3"><PaymentBadge status={r.paymentStatus} /></td>
                  <td className="px-4 py-3"><p>{r.manager.name}</p><p className="text-xs text-ink-subtle">{r.manager.email}</p></td>
                  <td className="px-4 py-3">{r.rosterCount} players</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setAction({ r, kind: 'roster' })} aria-label={`View roster for ${r.team.name}`}><Eye className="size-4" /></Button>
                    <Button size="sm" variant="secondary" onClick={() => setAction({ r, kind: 'status' })}>Status</Button>
                    {t.paymentRequired && <Button size="sm" variant="ghost" onClick={() => setAction({ r, kind: 'payment' })}>Payment</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {action?.kind === 'status' && <StatusDialog r={action.r} onClose={() => setAction(null)} />}
      {action?.kind === 'payment' && <PaymentDialog r={action.r} onClose={() => setAction(null)} />}
      {action?.kind === 'roster' && <RosterDialog r={action.r} onClose={() => setAction(null)} />}
    </>
  );
}

function StatusDialog({ r, onClose }: { r: AdminRegistrationDto; onClose: () => void }) {
  const qc = useQueryClient();
  const options = REGISTRATION_TRANSITIONS[r.status];
  const [to, setTo] = useState<RegistrationStatus | ''>(options[0] ?? '');
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  const m = useMutation({ mutationFn: () => api(`/admin/registrations/${r.id}/status`, { body: { version: r.version, to, reason, overrideCapacity: override } }), onSuccess: () => (qc.invalidateQueries(), onClose()) });
  const full = m.error instanceof ApiRequestError && m.error.code === 'CAPACITY_FULL';
  return (
    <Dialog open onClose={onClose} title={`${r.team.name}: change status`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending} disabled={!to || !reason.trim()}>Apply</Button></>}>
      {options.length === 0 ? <Alert tone="info" title={`${STATUS_LABELS.registration[r.status]} is final.`} /> : (
        <div className="space-y-4">
          <p className="text-sm">Current: <RegistrationBadge status={r.status} /></p>
          <FormError error={m.error} />
          <SelectField label="New status" value={to} onChange={(e) => setTo(e.target.value as RegistrationStatus)}>
            {options.map((s) => <option key={s} value={s}>{STATUS_LABELS.registration[s]}</option>)}
          </SelectField>
          <TextArea label="Reason (shown in the team's status history)" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          {(full || override) && <Checkbox label="Override division capacity (logged)" hint="Only if a spot was added or arranged offline." checked={override} onChange={(e) => setOverride(e.target.checked)} />}
        </div>
      )}
    </Dialog>
  );
}

function PaymentDialog({ r, onClose }: { r: AdminRegistrationDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [to, setTo] = useState<PaymentStatus>('manually_verified');
  const [reason, setReason] = useState('');
  const [ref, setRef] = useState('');
  const m = useMutation({ mutationFn: () => api(`/admin/registrations/${r.id}/payment-status`, { body: { version: r.version, to, reason, externalReference: ref || null } }), onSuccess: () => (qc.invalidateQueries(), onClose()) });
  return (
    <Dialog open onClose={onClose} title={`${r.team.name}: payment`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending} disabled={!reason.trim()}>Record</Button></>}>
      <div className="space-y-4">
        <Alert tone="info" title="“Paid (Verified)” is set only by a verified provider callback.">Use “Paid (Verified by Staff)” for checks, cash or other offline payments you've confirmed.</Alert>
        <FormError error={m.error} />
        <SelectField label="Payment status" value={to} onChange={(e) => setTo(e.target.value as PaymentStatus)}>
          {PAYMENT_STATUSES.filter((s) => s !== 'paid_verified').map((s) => <option key={s} value={s}>{STATUS_LABELS.payment[s]}</option>)}
        </SelectField>
        <TextField label="External reference" hint="Check #, receipt id, etc." value={ref} onChange={(e) => setRef(e.target.value)} />
        <TextArea label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Dialog>
  );
}

function RosterDialog({ r, onClose }: { r: AdminRegistrationDto; onClose: () => void }) {
  const q = useQuery({ queryKey: ['admin-roster', r.id], queryFn: () => api<RosterSnapshotDto[]>(`/admin/registrations/${r.id}/roster`) });
  const latest = q.data?.[0];
  return (
    <Dialog open onClose={onClose} title={`${r.team.name}: submitted roster`}>
      <p className="mb-3 text-xs text-ink-subtle">Viewing minors' names is logged in the audit trail.</p>
      {q.isPending ? <SkeletonList rows={1} /> : q.isError ? <ErrorState error={q.error} /> : !latest || latest.entries.length === 0 ? <p className="text-sm text-ink-muted">No players submitted.</p> : (
        <>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-ink-muted"><tr><th className="w-16 py-1">#</th><th className="py-1">Player</th></tr></thead>
            <tbody className="divide-y divide-line">{latest.entries.map((e, i) => <tr key={i}><td className="tabular py-1.5 font-semibold">{e.jerseyNumber}</td><td className="py-1.5">{e.playerName}</td></tr>)}</tbody>
          </table>
          <p className="mt-3 text-xs text-ink-subtle">Revision {latest.revision} of {q.data!.length} · {formatEasternStamp(latest.createdAt)}{latest.reason ? ` · ${latest.reason}` : ''}</p>
        </>
      )}
    </Dialog>
  );
}
