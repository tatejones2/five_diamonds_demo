import type { AuditEventDto, StaffRole } from '@fd/shared';
import { STAFF_ROLES } from '@fd/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Markdown } from '../../components/Markdown';
import { Alert, Badge, Button, Card, Checkbox, cx, Dialog, EmptyState, ErrorState, FormError, PageHeader, SelectField, SkeletonList, TextArea, TextField } from '../../components/ui';
import { api, ApiRequestError } from '../../lib/api';
import { formatEasternStamp } from '../../lib/format';
import { useAdminT, useVenues } from './AdminCore';

const fe = (e: unknown, k: string) => (e instanceof ApiRequestError ? e.fields[k] : undefined);

// ---- Venues ---------------------------------------------------------------------------------------

export function VenuesAdmin() {
  const venues = useVenues();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [fieldFor, setFieldFor] = useState<string | null>(null);
  const [fieldName, setFieldName] = useState('');
  const [lights, setLights] = useState(false);
  const addField = useMutation({ mutationFn: () => api(`/admin/venues/${fieldFor}/fields`, { body: { name: fieldName, hasLights: lights } }), onSuccess: () => (qc.invalidateQueries({ queryKey: ['admin-venues'] }), setFieldFor(null), setFieldName(''), setLights(false)) });
  return (
    <>
      <PageHeader title="Venues & fields" description="Only publish venue details the owner has verified." actions={<Button onClick={() => setEditing({})}><Plus className="size-4" aria-hidden /> Add venue</Button>} />
      {venues.isPending ? <SkeletonList /> : venues.isError ? <ErrorState error={venues.error} /> : venues.data.length === 0 ? <EmptyState title="No venues yet" /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {venues.data.map((v) => (
            <Card key={v.id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-xl font-semibold uppercase">{v.name}</h2>
                  <p className="text-sm text-ink-muted">{[v.addressLine1, v.city, v.state].filter(Boolean).join(', ') || 'No address'}</p>
                </div>
                {v.isPublished ? <Badge tone="ok">Public</Badge> : <Badge>Hidden</Badge>}
              </div>
              <ul className="mt-3 flex flex-wrap gap-2">{v.fields.map((f) => <li key={f.id}><Badge tone="info">{f.name}{f.hasLights ? ' · lights' : ''}</Badge></li>)}</ul>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(v)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => setFieldFor(v.id)}><Plus className="size-4" aria-hidden /> Field</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <VenueDialog v={editing} onClose={() => setEditing(null)} />}
      <Dialog open={!!fieldFor} onClose={() => setFieldFor(null)} title="Add field" footer={<><Button variant="secondary" onClick={() => setFieldFor(null)}>Cancel</Button><Button onClick={() => addField.mutate()} loading={addField.isPending}>Add</Button></>}>
        <div className="space-y-4">
          <FormError error={addField.error} />
          <TextField label="Field name" placeholder="Field 4" value={fieldName} onChange={(e) => setFieldName(e.target.value)} error={fe(addField.error, 'name')} />
          <Checkbox label="Has lights" checked={lights} onChange={(e) => setLights(e.target.checked)} />
        </div>
      </Dialog>
    </>
  );
}

function VenueDialog({ v, onClose }: { v: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: v.name ?? '', slug: v.slug ?? '', addressLine1: v.addressLine1 ?? '', city: v.city ?? '', state: v.state ?? '', postalCode: v.postalCode ?? '', directions: v.directions ?? '', parking: v.parking ?? '', policies: v.policies ?? '', mapUrl: v.mapUrl ?? '', isPublished: !!v.isPublished });
  const n = (x: string) => x.trim() || null;
  const data = { ...f, addressLine1: n(f.addressLine1), city: n(f.city), state: n(f.state), postalCode: n(f.postalCode), directions: n(f.directions), parking: n(f.parking), policies: n(f.policies), mapUrl: n(f.mapUrl) };
  const m = useMutation({ mutationFn: () => (v.id ? api(`/admin/venues/${v.id}`, { method: 'PATCH', body: { version: v.version, data } }) : api('/admin/venues', { body: data })), onSuccess: () => (qc.invalidateQueries({ queryKey: ['admin-venues'] }), onClose()) });
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open onClose={onClose} wide title={v.id ? `Edit ${v.name}` : 'Add venue'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Save</Button></>}>
      <div className="space-y-4">
        <FormError error={m.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: v.id ? f.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} />
          <TextField label="URL slug" required value={f.slug} onChange={set('slug')} error={fe(m.error, 'slug')} />
          <TextField label="Street address" value={f.addressLine1} onChange={set('addressLine1')} />
          <div className="grid grid-cols-[1fr_70px_100px] gap-2"><TextField label="City" value={f.city} onChange={set('city')} /><TextField label="State" maxLength={2} value={f.state} onChange={set('state')} /><TextField label="ZIP" value={f.postalCode} onChange={set('postalCode')} /></div>
        </div>
        <TextField label="Map link" type="url" value={f.mapUrl} onChange={set('mapUrl')} error={fe(m.error, 'mapUrl')} />
        <TextArea label="Directions (Markdown)" rows={3} value={f.directions} onChange={set('directions')} />
        <TextArea label="Parking" rows={2} value={f.parking} onChange={set('parking')} />
        <TextArea label="Facility policies" rows={3} value={f.policies} onChange={set('policies')} />
        <Checkbox label="Show on public Facilities page" checked={f.isPublished} onChange={(e) => setF({ ...f, isPublished: e.target.checked })} />
      </div>
    </Dialog>
  );
}

// ---- Staff & roles --------------------------------------------------------------------------------

const roleLabel: Record<StaffRole, string> = { super_admin: 'Super admin', tournament_director: 'Tournament director', scorekeeper: 'Scorekeeper', content_editor: 'Content editor' };

export function StaffAdmin() {
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ['admin-staff'], queryFn: () => api<{ id: string; role: StaffRole; tournamentId: string | null; userId: string; name: string; email: string; twoFactorEnabled: boolean | null }[]>('/admin/staff') });
  const ts = useQuery({ queryKey: ['admin-tournaments'], queryFn: () => api<{ id: string; title: string }[]>('/admin/tournaments') });
  const [f, setF] = useState({ email: '', role: 'tournament_director' as StaffRole, tournamentId: '' });
  const grant = useMutation({ mutationFn: () => api('/admin/staff', { body: { ...f, tournamentId: f.tournamentId || null } }), onSuccess: () => (qc.invalidateQueries({ queryKey: ['admin-staff'] }), setF({ ...f, email: '' })) });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/admin/staff/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-staff'] }) });
  const tName = (id: string | null) => (id ? (ts.data?.find((t) => t.id === id)?.title ?? 'Tournament') : 'All tournaments');
  return (
    <>
      <PageHeader title="Staff & roles" description="Least privilege: scope directors and scorekeepers to specific tournaments where possible." />
      <Card className="mb-6 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider">Grant a role</h2>
        <form className="grid gap-3 sm:grid-cols-[2fr_1fr_1.5fr_auto] sm:items-end" onSubmit={(e) => (e.preventDefault(), grant.mutate())}>
          <TextField label="Account email" type="email" required hint="They must have a verified account." value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={fe(grant.error, 'email')} />
          <SelectField label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as StaffRole })}>{STAFF_ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}</SelectField>
          <SelectField label="Scope" value={f.tournamentId} onChange={(e) => setF({ ...f, tournamentId: e.target.value })} disabled={f.role === 'super_admin' || f.role === 'content_editor'}>
            <option value="">All tournaments</option>
            {ts.data?.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </SelectField>
          <Button type="submit" loading={grant.isPending}>Grant</Button>
        </form>
        <FormError error={grant.error} />
      </Card>
      {staff.isPending ? <SkeletonList /> : staff.isError ? <ErrorState error={staff.error} /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-surface-alt text-left text-xs uppercase tracking-wider text-ink-muted"><tr><th className="px-4 py-2.5">Person</th><th className="px-4 py-2.5">Role</th><th className="px-4 py-2.5">Scope</th><th className="px-4 py-2.5">2FA</th><th className="px-4 py-2.5"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-line">
              {staff.data.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3"><p className="font-semibold">{s.name}</p><p className="text-xs text-ink-subtle">{s.email}</p></td>
                  <td className="px-4 py-3">{roleLabel[s.role]}</td>
                  <td className="px-4 py-3">{tName(s.tournamentId)}</td>
                  <td className="px-4 py-3">{s.twoFactorEnabled ? <Badge tone="ok">On</Badge> : <Badge tone="warn">Off</Badge>}</td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => confirm(`Remove ${roleLabel[s.role]} from ${s.name}?`) && revoke.mutate(s.id)}>Revoke</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <FormError error={revoke.error} />
    </>
  );
}

// ---- Content pages ---------------------------------------------------------------------------------

interface AdminPage { key: string; title: string; legal: boolean; draftBody: string; publishedBody: string | null; status: string; ownerApproved: boolean; seoDescription: string | null; version: number; publishedAt: string | null; hasUnpublishedChanges: boolean }

export function ContentAdmin() {
  const q = useQuery({ queryKey: ['admin-pages'], queryFn: () => api<AdminPage[]>('/admin/content/pages') });
  const [editing, setEditing] = useState<AdminPage | null>(null);
  return (
    <>
      <PageHeader title="Pages" description="Draft, preview and publish site copy. Legal pages stay hidden until marked owner-approved." />
      {q.isPending ? <SkeletonList /> : q.isError ? <ErrorState error={q.error} /> : (
        <Card className="divide-y divide-line">
          {q.data.map((p) => (
            <div key={p.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="font-semibold">{p.title}</p>
                <p className="text-xs text-ink-subtle">{p.publishedAt ? `Published ${formatEasternStamp(p.publishedAt)}` : 'Never published'}</p>
              </div>
              <div className="flex items-center gap-2">
                {p.legal && !p.ownerApproved && <Badge tone="danger">Unpublished: needs owner/legal approval</Badge>}
                {p.status === 'published' ? <Badge tone="ok">Live</Badge> : <Badge>Draft</Badge>}
                {p.hasUnpublishedChanges && <Badge tone="warn">Unpublished edits</Badge>}
                <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>Edit</Button>
              </div>
            </div>
          ))}
        </Card>
      )}
      {editing && <PageDialog p={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PageDialog({ p, onClose }: { p: AdminPage; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(p.title);
  const [body, setBody] = useState(p.draftBody);
  const [seo, setSeo] = useState(p.seoDescription ?? '');
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [approved, setApproved] = useState(p.ownerApproved);
  const [version, setVersion] = useState(p.version);
  const save = useMutation({ mutationFn: () => api<AdminPage[]>(`/admin/content/pages/${p.key}`, { method: 'PUT', body: { version, title, body, seoDescription: seo || null } }), onSuccess: (rows) => (setVersion(rows.find((r) => r.key === p.key)!.version), qc.invalidateQueries({ queryKey: ['admin-pages'] })) });
  const publish = useMutation({
    mutationFn: async () => {
      const rows = await api<AdminPage[]>(`/admin/content/pages/${p.key}`, { method: 'PUT', body: { version, title, body, seoDescription: seo || null } });
      const v = rows.find((r) => r.key === p.key)!.version;
      await api(`/admin/content/pages/${p.key}/publish`, { body: { version: v, ownerApproved: p.legal ? approved : undefined } });
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['admin-pages'] }), onClose()),
  });
  return (
    <Dialog open onClose={onClose} wide title={`Edit: ${p.title}`} footer={<><Button variant="secondary" onClick={() => save.mutate()} loading={save.isPending}>Save draft</Button><Button variant="flame" onClick={() => publish.mutate()} loading={publish.isPending}>Publish</Button></>}>
      <div className="space-y-4">
        <FormError error={save.error ?? publish.error} />
        {save.isSuccess && <Alert tone="ok" title="Draft saved" />}
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div role="tablist" className="flex gap-1">
          {(['edit', 'preview'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={cx('rounded-md px-3 py-1.5 text-sm font-semibold capitalize', tab === t ? 'bg-surface-sunk' : 'text-ink-muted')}>{t}</button>)}
        </div>
        {tab === 'edit' ? <TextArea label="Body (Markdown)" rows={14} value={body} onChange={(e) => setBody(e.target.value)} hint="Headings: ## Heading. Links: [text](https://…). Raw HTML is not rendered." /> : <div className="min-h-64 rounded-lg border border-line p-4"><Markdown>{body}</Markdown></div>}
        <TextField label="Search description" hint="Optional, ~155 characters" value={seo} onChange={(e) => setSeo(e.target.value)} />
        {p.legal && <Checkbox label="Owner and counsel have approved this text" hint="Legal pages show a “being finalized” notice publicly until this is checked." checked={approved} onChange={(e) => setApproved(e.target.checked)} />}
      </div>
    </Dialog>
  );
}

// ---- News ------------------------------------------------------------------------------------------

export function NewsAdmin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-news'], queryFn: () => api<any[]>('/admin/news') });
  const [editing, setEditing] = useState<any | null>(null);
  const pub = useMutation({ mutationFn: (n: any) => api(`/admin/news/${n.id}/publish`, { body: { version: n.version, publish: n.status !== 'published' } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-news'] }) });
  return (
    <>
      <PageHeader title="News" actions={<Button onClick={() => setEditing({})}><Plus className="size-4" aria-hidden /> New post</Button>} />
      <FormError error={pub.error} />
      {q.isPending ? <SkeletonList /> : q.isError ? <ErrorState error={q.error} /> : q.data.length === 0 ? <EmptyState title="No posts" /> : (
        <Card className="divide-y divide-line">
          {q.data.map((n) => (
            <div key={n.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div><p className="font-semibold">{n.title}</p><p className="text-xs text-ink-subtle">/news/{n.slug}</p></div>
              <div className="flex items-center gap-2">
                {n.status === 'published' ? <Badge tone="ok">Live</Badge> : <Badge>Draft</Badge>}
                {n.status === 'published' && n.draftBody !== n.publishedBody && <Badge tone="warn">Unpublished edits</Badge>}
                <Button size="sm" variant="secondary" onClick={() => setEditing(n)}>Edit</Button>
                <Button size="sm" variant={n.status === 'published' ? 'ghost' : 'flame'} onClick={() => pub.mutate(n)}>{n.status === 'published' ? 'Unpublish' : 'Publish'}</Button>
              </div>
            </div>
          ))}
        </Card>
      )}
      {editing && <NewsDialog n={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function NewsDialog({ n, onClose }: { n: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: n.title ?? '', slug: n.slug ?? '', excerpt: n.excerpt ?? '', body: n.draftBody ?? '' });
  const data = { ...f, excerpt: f.excerpt || null, tournamentId: n.tournamentId ?? null };
  const m = useMutation({ mutationFn: () => (n.id ? api(`/admin/news/${n.id}`, { method: 'PATCH', body: { version: n.version, data } }) : api('/admin/news', { body: data })), onSuccess: () => (qc.invalidateQueries({ queryKey: ['admin-news'] }), onClose()) });
  return (
    <Dialog open onClose={onClose} wide title={n.id ? 'Edit post' : 'New post'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Save draft</Button></>}>
      <div className="space-y-4">
        <FormError error={m.error} />
        <TextField label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value, slug: n.id ? f.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) })} />
        <TextField label="URL slug" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} error={fe(m.error, 'slug')} />
        <TextField label="Excerpt" value={f.excerpt} onChange={(e) => setF({ ...f, excerpt: e.target.value })} />
        <TextArea label="Body (Markdown)" rows={12} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <p className="text-xs text-ink-subtle">Don't reference affiliate organizations or sponsors without owner confirmation.</p>
      </div>
    </Dialog>
  );
}

// ---- Partners & staff profiles ---------------------------------------------------------------------

export function PartnersAdmin() {
  const qc = useQueryClient();
  const sponsors = useQuery({ queryKey: ['admin-sponsors'], queryFn: () => api<any[]>('/admin/sponsors') });
  const profiles = useQuery({ queryKey: ['admin-staff-profiles'], queryFn: () => api<any[]>('/admin/staff-profiles') });
  const [sp, setSp] = useState<any | null>(null);
  const [pr, setPr] = useState<any | null>(null);
  const saveSp = useMutation({ mutationFn: (d: any) => (d.id ? api(`/admin/sponsors/${d.id}`, { method: 'PATCH', body: clean(d) }) : api('/admin/sponsors', { body: clean(d) })), onSuccess: () => (qc.invalidateQueries({ queryKey: ['admin-sponsors'] }), setSp(null)) });
  const savePr = useMutation({ mutationFn: (d: any) => (d.id ? api(`/admin/staff-profiles/${d.id}`, { method: 'PATCH', body: clean(d) }) : api('/admin/staff-profiles', { body: clean(d) })), onSuccess: () => (qc.invalidateQueries({ queryKey: ['admin-staff-profiles'] }), setPr(null)) });
  return (
    <>
      <PageHeader title="Partners & staff" description="Partners appear publicly only when published AND owner-approved. Staff contact details appear only with permission." />
      <div className="grid gap-6 xl:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold uppercase">Partners / sponsors</h2><Button size="sm" onClick={() => setSp({ name: '', websiteUrl: '', tier: '', isPublished: false, ownerApproved: false, sortOrder: 0 })}><Plus className="size-4" aria-hidden /> Add</Button></div>
          {sponsors.data?.length === 0 && <EmptyState title="No partners yet" />}
          <ul className="space-y-2">{sponsors.data?.map((s) => <li key={s.id} className="card flex items-center justify-between p-3"><span className="font-semibold">{s.name}</span><span className="flex gap-2">{s.isPublished && s.ownerApproved ? <Badge tone="ok">Public</Badge> : <Badge>Hidden</Badge>}<Button size="sm" variant="ghost" onClick={() => setSp(s)}>Edit</Button></span></li>)}</ul>
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold uppercase">Staff directory</h2><Button size="sm" onClick={() => setPr({ name: '', title: '', bio: '', publicEmail: '', publicPhone: '', contactPublishingApproved: false, isPublished: false, sortOrder: 0 })}><Plus className="size-4" aria-hidden /> Add</Button></div>
          {profiles.data?.length === 0 && <EmptyState title="No staff profiles">Confirm names, titles and contact permissions with each person first.</EmptyState>}
          <ul className="space-y-2">{profiles.data?.map((s) => <li key={s.id} className="card flex items-center justify-between p-3"><span><span className="font-semibold">{s.name}</span> <span className="text-sm text-ink-muted">· {s.title}</span></span><span className="flex gap-2">{s.isPublished ? <Badge tone="ok">Public</Badge> : <Badge>Hidden</Badge>}<Button size="sm" variant="ghost" onClick={() => setPr(s)}>Edit</Button></span></li>)}</ul>
        </section>
      </div>
      {sp && (
        <Dialog open onClose={() => setSp(null)} title={sp.id ? 'Edit partner' : 'Add partner'} footer={<><Button variant="secondary" onClick={() => setSp(null)}>Cancel</Button><Button onClick={() => saveSp.mutate(sp)} loading={saveSp.isPending}>Save</Button></>}>
          <div className="space-y-4">
            <FormError error={saveSp.error} />
            <TextField label="Name" value={sp.name} onChange={(e) => setSp({ ...sp, name: e.target.value })} />
            <TextField label="Website" type="url" value={sp.websiteUrl ?? ''} onChange={(e) => setSp({ ...sp, websiteUrl: e.target.value })} error={fe(saveSp.error, 'websiteUrl')} />
            <TextField label="Tier" value={sp.tier ?? ''} onChange={(e) => setSp({ ...sp, tier: e.target.value })} />
            <Checkbox label="Owner approved this partner listing and logo use" checked={sp.ownerApproved} onChange={(e) => setSp({ ...sp, ownerApproved: e.target.checked })} />
            <Checkbox label="Published" checked={sp.isPublished} onChange={(e) => setSp({ ...sp, isPublished: e.target.checked })} />
          </div>
        </Dialog>
      )}
      {pr && (
        <Dialog open onClose={() => setPr(null)} title={pr.id ? 'Edit staff profile' : 'Add staff profile'} footer={<><Button variant="secondary" onClick={() => setPr(null)}>Cancel</Button><Button onClick={() => savePr.mutate(pr)} loading={savePr.isPending}>Save</Button></>}>
          <div className="space-y-4">
            <FormError error={savePr.error} />
            <TextField label="Name" value={pr.name} onChange={(e) => setPr({ ...pr, name: e.target.value })} />
            <TextField label="Title" value={pr.title} onChange={(e) => setPr({ ...pr, title: e.target.value })} />
            <TextArea label="Bio" rows={3} value={pr.bio ?? ''} onChange={(e) => setPr({ ...pr, bio: e.target.value })} />
            <div className="grid gap-4 sm:grid-cols-2"><TextField label="Public email" type="email" value={pr.publicEmail ?? ''} onChange={(e) => setPr({ ...pr, publicEmail: e.target.value })} /><TextField label="Public phone" value={pr.publicPhone ?? ''} onChange={(e) => setPr({ ...pr, publicPhone: e.target.value })} /></div>
            <Checkbox label="This person approved publishing their contact details" checked={pr.contactPublishingApproved} onChange={(e) => setPr({ ...pr, contactPublishingApproved: e.target.checked })} />
            <Checkbox label="Published" checked={pr.isPublished} onChange={(e) => setPr({ ...pr, isPublished: e.target.checked })} />
          </div>
        </Dialog>
      )}
    </>
  );
}

function clean(d: any) {
  const { id: _id, createdAt: _c, updatedAt: _u, logoAssetId, photoAssetId: _p, ...rest } = d;
  const out: any = {};
  for (const [k, v] of Object.entries(rest)) out[k] = v === '' ? null : v;
  if ('websiteUrl' in d) out.logoAssetId = logoAssetId ?? null;
  return out;
}

// ---- FAQs ------------------------------------------------------------------------------------------

export function FaqAdmin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-faqs'], queryFn: () => api<any[]>('/admin/faqs') });
  const [f, setF] = useState<any | null>(null);
  const save = useMutation({ mutationFn: (d: any) => (d.id ? api(`/admin/faqs/${d.id}`, { method: 'PATCH', body: { question: d.question, answer: d.answer, isPublished: d.isPublished, sortOrder: Number(d.sortOrder) } }) : api('/admin/faqs', { body: d })), onSuccess: () => (qc.invalidateQueries({ queryKey: ['admin-faqs'] }), setF(null)) });
  return (
    <>
      <PageHeader title="FAQs" actions={<Button onClick={() => setF({ question: '', answer: '', isPublished: false, sortOrder: (q.data?.length ?? 0) })}><Plus className="size-4" aria-hidden /> Add FAQ</Button>} />
      {q.isPending ? <SkeletonList /> : q.isError ? <ErrorState error={q.error} /> : (
        <Card className="divide-y divide-line">{q.data.map((x) => <div key={x.id} className="flex items-center justify-between gap-3 px-5 py-3"><span className="font-semibold">{x.question}</span><span className="flex gap-2">{x.isPublished ? <Badge tone="ok">Live</Badge> : <Badge>Hidden</Badge>}<Button size="sm" variant="ghost" onClick={() => setF(x)}>Edit</Button></span></div>)}</Card>
      )}
      {f && (
        <Dialog open onClose={() => setF(null)} title="FAQ" footer={<><Button variant="secondary" onClick={() => setF(null)}>Cancel</Button><Button onClick={() => save.mutate(f)} loading={save.isPending}>Save</Button></>}>
          <div className="space-y-4">
            <FormError error={save.error} />
            <TextField label="Question" value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} />
            <TextArea label="Answer (Markdown)" rows={5} value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} />
            <TextField label="Order" type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} />
            <Checkbox label="Published" checked={f.isPublished} onChange={(e) => setF({ ...f, isPublished: e.target.checked })} />
          </div>
        </Dialog>
      )}
    </>
  );
}

// ---- Inquiries ---------------------------------------------------------------------------------------

export function InquiriesAdmin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-inquiries'], queryFn: () => api<any[]>('/admin/inquiries') });
  const set = useMutation({ mutationFn: (v: { id: string; status: string }) => api(`/admin/inquiries/${v.id}/status`, { body: { status: v.status } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-inquiries'] }) });
  return (
    <>
      <PageHeader title="Inquiries" description="Contact form submissions. Visible to content staff only." />
      {q.isPending ? <SkeletonList /> : q.isError ? <ErrorState error={q.error} /> : q.data.length === 0 ? <EmptyState title="No messages" /> : (
        <ul className="space-y-3">
          {q.data.map((m) => (
            <li key={m.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-semibold">{m.name} <span className="font-normal text-ink-muted">· {m.email}{m.phone ? ` · ${m.phone}` : ''}</span></p><p className="text-xs text-ink-subtle">{m.topic.replace('_', ' ')} · {formatEasternStamp(m.createdAt)}</p></div>
                <select aria-label="Status" value={m.status} onChange={(e) => set.mutate({ id: m.id, status: e.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm">
                  {['new', 'in_progress', 'closed', 'spam'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{m.message}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---- Audit -------------------------------------------------------------------------------------------

export function AuditLog({ tournamentId }: { tournamentId?: string }) {
  const q = useInfiniteQuery({
    queryKey: ['audit', tournamentId ?? 'all'],
    queryFn: ({ pageParam }) => api<{ items: AuditEventDto[]; nextBefore: string | null }>(`/admin/audit-events?limit=50${tournamentId ? `&tournamentId=${tournamentId}` : ''}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (p) => p.nextBefore ?? undefined,
  });
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} />;
  const items = q.data.pages.flatMap((p) => p.items);
  return (
    <>
      {!tournamentId && <PageHeader title="Audit log" description="Append-only record of staff and sensitive actions." />}
      {items.length === 0 ? <EmptyState title="No audit events" /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-alt text-left text-xs uppercase tracking-wider text-ink-muted"><tr><th className="px-4 py-2.5">When (ET)</th><th className="px-4 py-2.5">Who</th><th className="px-4 py-2.5">Action</th><th className="px-4 py-2.5">Details</th></tr></thead>
            <tbody className="divide-y divide-line">
              {items.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">{formatEasternStamp(e.at)}</td>
                  <td className="px-4 py-2.5">{e.actor?.name ?? 'System'}</td>
                  <td className="px-4 py-2.5"><code className="text-xs">{e.action}</code></td>
                  <td className="px-4 py-2.5 text-ink-muted">{e.summary}{e.reason && <span className="block text-xs">Reason: {e.reason}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {q.hasNextPage && <Button variant="secondary" className="mt-4" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>Load older</Button>}
    </>
  );
}

export function TournamentAudit() {
  const t = useAdminT();
  return <AuditLog tournamentId={t.id} />;
}
