'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { AdminActionModal } from '@/components/AdminActionModal';
import { EmptyState } from '@/components/EmptyState';
import { MapPin, X } from '@/lib/icons';
import { formatRelativeTime } from '@/lib/time';
import { AdminLocation, adminDeleteLocation, adminListLocations, adminMergeLocation, adminReviewLocation, adminSaveLocation } from '@/services/locations';

type Kind = AdminLocation['kind'];
type Tab = 'browse' | 'requests' | 'rejected';
const TABS: { key: Tab; label: string }[] = [
  { key: 'browse', label: 'Countries, regions & cities' },
  { key: 'requests', label: 'Requests' },
  { key: 'rejected', label: 'Rejected' },
];

type Dialog =
  | { type: 'approve'; row: AdminLocation }
  | { type: 'reject'; row: AdminLocation }
  | { type: 'merge'; row: AdminLocation }
  | { type: 'deactivate'; row: AdminLocation }
  | { type: 'delete'; row: AdminLocation }
  | { type: 'edit'; row: AdminLocation | null; kind: Kind; parentId?: string };

const STATUS_TONE = { pending: 'warning', approved: 'success', inactive: 'neutral', rejected: 'neutral' } as const;
const KIND_LABEL: Record<Kind, string> = { country: 'country', region: 'region', city: 'city' };

export default function AdminLocationsPage() {
  const [rows, setRows] = useState<AdminLocation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('browse');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'name' | 'newest'>('name');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    adminListLocations().then((r) => {
      setLoadError(r.error ?? null);
      setRows(r.rows);
    });
  };
  useEffect(load, []);

  const done = (text: string, result: { error?: string }) => {
    if (result.error) {
      setFlash({ ok: false, text: result.error });
    } else {
      setFlash({ ok: true, text });
      load();
    }
    return result;
  };

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (tab === 'requests' && r.status !== 'pending') return false;
      if (tab === 'rejected' && r.status !== 'rejected') return false;
      return (
        !q ||
        [r.name, r.nameSo, r.nameAm, r.iso2, r.parentName, ...(r.aliases ?? [])].some((v) => v && v.toLowerCase().includes(q))
      );
    });
    return list.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt)));
  }, [rows, tab, query, sort]);

  const deleteDescription = (() => {
    if (dialog?.type !== 'delete') return '';
    const s = subtreeStats(rows ?? [], dialog.row.id);
    const parts = [`This permanently deletes “${dialog.row.name}”`];
    if (s.places > 1) parts[0] += ` and the ${s.places - 1} place${s.places - 1 === 1 ? '' : 's'} under it`;
    parts[0] += ' from the app and the website.';
    parts.push(
      s.listings > 0
        ? `${s.listings} listing${s.listings === 1 ? '' : 's'} use${s.listings === 1 ? 's' : ''} ${s.places > 1 ? 'these places' : 'this place'}. They stay published and keep their city name, but won’t appear when people filter by location.`
        : 'No listings use it.'
    );
    parts.push('This cannot be undone. To just hide it, use Deactivate instead.');
    return parts.join(' ');
  })();

  const pendingCount = rows?.filter((r) => r.status === 'pending').length ?? 0;
  const approvedCities = (rows ?? []).filter((r) => r.kind === 'city' && r.status === 'approved');
  const approvedParents = (rows ?? []).filter((r) => r.kind !== 'city' && r.status === 'approved');

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-textPrimary">Countries &amp; Locations</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setDialog({ type: 'edit', row: null, kind: 'country' })}>
            Add country
          </Button>
        </div>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-primary text-primaryText' : 'text-textSecondary hover:bg-inputBackground'}`}
          >
            {t.label}
            {t.key === 'requests' && pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        ))}
      </div>

      <div className="mb-4 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, translation, alias or code"
          className="min-w-0 flex-1 rounded-md border border-border bg-inputBackground p-2.5 text-sm text-textPrimary outline-none focus:border-primary"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as 'name' | 'newest')}
          className="rounded-md border border-border bg-inputBackground p-2.5 text-sm text-textPrimary"
        >
          <option value="name">A–Z</option>
          <option value="newest">Newest first</option>
        </select>
      </div>

      {flash && (
        <p className={`mb-3 rounded-md px-3 py-2 text-sm ${flash.ok ? 'bg-success/15 text-success' : 'bg-error/10 text-error'}`}>{flash.text}</p>
      )}

      {loadError ? (
        <p className="text-sm text-error">Couldn’t load locations: {loadError}</p>
      ) : !rows ? (
        <p className="text-sm text-textSecondary">Loading…</p>
      ) : tab === 'browse' ? (
        <TreeView
          rows={rows}
          query={query}
          onEdit={(row) => setDialog({ type: 'edit', row, kind: row.kind })}
          onAdd={(kind, parentId) => setDialog({ type: 'edit', row: null, kind, parentId })}
          onDeactivate={(row) => setDialog({ type: 'deactivate', row })}
          onDelete={(row) => setDialog({ type: 'delete', row })}
          onReactivate={async (row) => {
            done(`${row.name} reactivated.`, await adminReviewLocation(row.id, 'reactivate'));
          }}
        />
      ) : visible.length === 0 ? (
        <EmptyState icon={MapPin} title="Nothing here" message={tab === 'requests' ? 'No pending location requests.' : 'No matching locations.'} />
      ) : (
        <Card elevated={false} className="divide-y divide-border p-0">
          {visible.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-textPrimary">{r.name}</span>
                  <Badge label={r.status} tone={STATUS_TONE[r.status]} />
                  <Badge label={r.kind === 'country' && r.isAppRegion ? 'app region' : KIND_LABEL[r.kind]} />
                  {r.isFeatured && <Badge label="featured" tone="accent" />}
                </div>
                <p className="mt-0.5 text-xs text-textMuted">
                  {[
                    r.parentName,
                    r.iso2,
                    r.currencyCodes?.length ? `currencies: ${r.currencyCodes.join(', ')}` : null,
                    `${r.listingCount} listing${r.listingCount === 1 ? '' : 's'}`,
                    r.requesterName ? `requested by ${r.requesterName}` : null,
                    formatRelativeTime(new Date(r.createdAt).getTime()),
                    r.rejectionReason ? `reason: ${r.rejectionReason}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {r.status === 'pending' && (
                  <>
                    <Button size="sm" onClick={() => setDialog({ type: 'approve', row: r })}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'merge', row: r })}>
                      Merge
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setDialog({ type: 'reject', row: r })}>
                      Reject
                    </Button>
                  </>
                )}
                {(r.status === 'approved' || r.status === 'inactive') && (
                  <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'edit', row: r, kind: r.kind })}>
                    Edit
                  </Button>
                )}
                {r.status === 'approved' && (
                  <Button size="sm" variant="danger" onClick={() => setDialog({ type: 'deactivate', row: r })}>
                    Deactivate
                  </Button>
                )}
                {r.status === 'inactive' && (
                  <Button size="sm" onClick={async () => done(`${r.name} reactivated.`, await adminReviewLocation(r.id, 'reactivate'))}>
                    Reactivate
                  </Button>
                )}
                {(r.status === 'rejected' || r.status === 'inactive') && (
                  <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'delete', row: r })}>
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      <AdminActionModal
        open={dialog?.type === 'reject'}
        title={`Reject “${dialog && 'row' in dialog ? dialog.row?.name : ''}”`}
        description="The location won’t become a selectable option. Listings that used this name keep showing it."
        confirmLabel="Reject"
        danger
        requireReason={false}
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => (dialog?.type === 'reject' ? done('Request rejected.', await adminReviewLocation(dialog.row.id, 'reject', reason)) : {})}
      />
      <AdminActionModal
        open={dialog?.type === 'deactivate'}
        title={`Deactivate “${dialog && 'row' in dialog ? dialog.row?.name : ''}”`}
        description="Removes it from the Home filter and every picker. Existing listings keep their location. You can reactivate it later."
        confirmLabel="Deactivate"
        danger
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => (dialog?.type === 'deactivate' ? done('Location deactivated.', await adminReviewLocation(dialog.row.id, 'deactivate', reason)) : {})}
      />
      <AdminActionModal
        open={dialog?.type === 'delete'}
        title={`Delete “${dialog && 'row' in dialog ? dialog.row?.name : ''}”`}
        description={deleteDescription}
        confirmLabel="Delete permanently"
        danger
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => (dialog?.type === 'delete' ? done('Deleted.', await adminDeleteLocation(dialog.row.id, reason)) : {})}
      />

      {dialog?.type === 'approve' && (
        <FormDialog title="Approve location" onClose={() => setDialog(null)}>
          <ApproveForm
            row={dialog.row}
            onSubmit={async (name) => {
              const res = done(`${name} approved.`, await adminReviewLocation(dialog.row.id, 'approve', undefined, name));
              if (!res.error) setDialog(null);
              return res;
            }}
          />
        </FormDialog>
      )}
      {dialog?.type === 'merge' && (
        <FormDialog title="Merge into an existing city" onClose={() => setDialog(null)}>
          <MergeForm
            row={dialog.row}
            targets={approvedCities.filter((c) => c.id !== dialog.row.id)}
            onSubmit={async (targetId) => {
              const res = done('Merged.', await adminMergeLocation(dialog.row.id, targetId));
              if (!res.error) setDialog(null);
              return res;
            }}
          />
        </FormDialog>
      )}
      {dialog?.type === 'edit' && (
        <FormDialog title={dialog.row ? `Edit ${dialog.row.name}` : `Add ${KIND_LABEL[dialog.kind]}`} onClose={() => setDialog(null)}>
          <EditForm
            row={dialog.row}
            kind={dialog.kind}
            presetParentId={dialog.parentId}
            parents={approvedParents}
            onSubmit={async (input) => {
              const res = done('Saved.', await adminSaveLocation(input));
              if (!res.error) setDialog(null);
              return res;
            }}
          />
        </FormDialog>
      )}
    </div>
  );
}

function FormDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-xl bg-surface p-6 pb-8 shadow-md md:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-bold text-textPrimary">{title}</h2>
          <button onClick={onClose} aria-label="Dismiss" className="rounded-full p-1 hover:bg-inputBackground">
            <X size={18} className="text-textMuted" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md border border-border bg-inputBackground p-3 text-sm text-textPrimary outline-none focus:border-primary';

function useSubmit(run: () => Promise<{ error?: string }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await run();
    setBusy(false);
    if (res.error) setError(res.error);
  };
  return { busy, error, submit };
}

function ApproveForm({ row, onSubmit }: { row: AdminLocation; onSubmit: (name: string) => Promise<{ error?: string }> }) {
  const [name, setName] = useState(row.name);
  const { busy, error, submit } = useSubmit(() => onSubmit(name));
  return (
    <div>
      <p className="mb-2 text-sm text-textSecondary">
        Edit the spelling if needed. Listings that used the requested name are updated to the approved name.
        {row.parentName ? ` Under: ${row.parentName}.` : ''}
      </p>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputCls} />
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
      <Button className="mt-4" fullWidth loading={busy} onClick={submit}>
        Approve
      </Button>
    </div>
  );
}

function MergeForm({ row, targets, onSubmit }: { row: AdminLocation; targets: AdminLocation[]; onSubmit: (targetId: string) => Promise<{ error?: string }> }) {
  const [target, setTarget] = useState('');
  const { busy, error, submit } = useSubmit(() => (target ? onSubmit(target) : Promise.resolve({ error: 'Choose a city.' })));
  return (
    <div>
      <p className="mb-2 text-sm text-textSecondary">
        “{row.name}” is a duplicate of… Listings using it move to the chosen city and this request is closed.
      </p>
      <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputCls}>
        <option value="">Select a city</option>
        {[...targets]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.parentName ? ` (${t.parentName})` : ''}
            </option>
          ))}
      </select>
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
      <Button className="mt-4" fullWidth loading={busy} onClick={submit}>
        Merge
      </Button>
    </div>
  );
}

const splitList = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

function EditForm({
  row,
  kind,
  parents,
  presetParentId,
  onSubmit,
}: {
  row: AdminLocation | null;
  kind: Kind;
  parents: AdminLocation[];
  presetParentId?: string;
  onSubmit: (input: Parameters<typeof adminSaveLocation>[0]) => Promise<{ error?: string }>;
}) {
  const countries = useMemo(() => parents.filter((p) => p.kind === 'country').sort((a, b) => a.name.localeCompare(b.name)), [parents]);
  const wantedParent = row?.parentId ?? presetParentId;
  const parentRow = wantedParent ? parents.find((p) => p.id === wantedParent) : undefined;
  // For a city the parent is a region (or a country); the form shows country first, then region.
  const [countryId, setCountryId] = useState(parentRow ? (parentRow.kind === 'country' ? parentRow.id : parentRow.parentId ?? '') : '');
  const [regionId, setRegionId] = useState(parentRow?.kind === 'region' ? parentRow.id : '');
  const regions = useMemo(() => parents.filter((p) => p.kind === 'region' && p.parentId === countryId).sort((a, b) => a.name.localeCompare(b.name)), [parents, countryId]);

  const [name, setName] = useState(row?.name ?? '');
  const [nameSo, setNameSo] = useState(row?.nameSo ?? '');
  const [nameAm, setNameAm] = useState(row?.nameAm ?? '');
  const [aliases, setAliases] = useState((row?.aliases ?? []).join(', '));
  const [currencies, setCurrencies] = useState((row?.currencyCodes ?? []).join(', '));
  const [defaultCurrency, setDefaultCurrency] = useState(row?.defaultCurrency ?? '');
  const [isAppRegion, setIsAppRegion] = useState(row?.isAppRegion ?? false);
  const [isFeatured, setIsFeatured] = useState(row?.isFeatured ?? false);

  const { busy, error, submit } = useSubmit(() => {
    let parentId: string | null = null;
    if (kind === 'region') {
      if (!countryId) return Promise.resolve({ error: 'Choose the country.' });
      parentId = countryId;
    } else if (kind === 'city') {
      parentId = regionId || countryId;
      if (!parentId) return Promise.resolve({ error: 'Choose the country (and region, if it has one).' });
    }
    const codes = splitList(currencies.toUpperCase());
    return onSubmit({
      id: row?.id ?? null,
      kind,
      name,
      parentId,
      currencyCodes: codes.length ? codes : null,
      defaultCurrency: defaultCurrency.trim() ? defaultCurrency.trim().toUpperCase() : null,
      nameSo,
      nameAm,
      aliases: splitList(aliases),
      isAppRegion,
      isFeatured,
    });
  });

  return (
    <div className="space-y-3">
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Name (English — stored on listings)" className={inputCls} />
      <div className="grid grid-cols-2 gap-2">
        <input value={nameSo} onChange={(e) => setNameSo(e.target.value)} placeholder="Name in Somali" className={inputCls} />
        <input value={nameAm} onChange={(e) => setNameAm(e.target.value)} placeholder="Name in Amharic" className={inputCls} />
      </div>
      <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Other spellings for search (comma-separated)" className={inputCls} />
      {kind !== 'country' && (
        <select
          value={countryId}
          onChange={(e) => {
            setCountryId(e.target.value);
            setRegionId('');
          }}
          className={inputCls}
        >
          <option value="">Country</option>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {kind === 'city' && regions.length > 0 && (
        <select value={regionId} onChange={(e) => setRegionId(e.target.value)} className={inputCls}>
          <option value="">Region (optional)</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}
      <input
        value={currencies}
        onChange={(e) => setCurrencies(e.target.value)}
        placeholder={kind === 'country' ? 'Currencies sellers can use, e.g. USD, SOS' : 'Currencies (leave empty to inherit)'}
        className={inputCls}
      />
      <input value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)} placeholder="Default currency (optional, e.g. USD)" className={inputCls} />
      {kind === 'country' && (
        <label className="flex items-center gap-2 text-sm text-textSecondary">
          <input type="checkbox" checked={isAppRegion} onChange={(e) => setIsAppRegion(e.target.checked)} />
          App-specific region (not a sovereign country)
        </label>
      )}
      {kind === 'city' && (
        <label className="flex items-center gap-2 text-sm text-textSecondary">
          <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} />
          Launch / featured city
        </label>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
      <Button fullWidth loading={busy} onClick={submit}>
        Save
      </Button>
    </div>
  );
}

// One block per country; inside it every region with its cities, so it is always
// clear which country a region belongs to and which region a city belongs to.
function TreeView({
  rows,
  query,
  onEdit,
  onAdd,
  onDeactivate,
  onReactivate,
  onDelete,
}: {
  rows: AdminLocation[];
  query: string;
  onEdit: (row: AdminLocation) => void;
  onAdd: (kind: Kind, parentId: string) => void;
  onDeactivate: (row: AdminLocation) => void;
  onReactivate: (row: AdminLocation) => void;
  onDelete: (row: AdminLocation) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const live = useMemo(() => rows.filter((r) => r.status === 'approved' || r.status === 'inactive'), [rows]);
  const kids = useMemo(() => {
    const m = new Map<string, AdminLocation[]>();
    for (const r of live) {
      if (!r.parentId) continue;
      const list = m.get(r.parentId) ?? [];
      list.push(r);
      m.set(r.parentId, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [live]);
  const countries = useMemo(() => live.filter((r) => r.kind === 'country').sort((a, b) => a.name.localeCompare(b.name)), [live]);

  const own = (r: AdminLocation) => [r.name, r.nameSo, r.nameAm, r.iso2, ...(r.aliases ?? [])].some((v) => v && v.toLowerCase().includes(q));
  const matches = (r: AdminLocation): boolean => !q || own(r) || (kids.get(r.id) ?? []).some(matches);
  const isOpen = (r: AdminLocation) => (q ? true : open[r.id] ?? r.kind === 'country');
  const toggle = (r: AdminLocation) => setOpen((o) => ({ ...o, [r.id]: !isOpen(r) }));

  const renderRow = (r: AdminLocation, depth: number) => {
    const children = kids.get(r.id) ?? [];
    return (
      <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2" style={{ paddingLeft: 16 + depth * 20 }}>
        <div className="flex min-w-0 items-center gap-2">
          {children.length > 0 ? (
            <button onClick={() => toggle(r)} aria-label={isOpen(r) ? 'Collapse' : 'Expand'} className="w-5 shrink-0 text-textMuted">
              {isOpen(r) ? '▾' : '▸'}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <span className={`truncate text-sm ${r.kind === 'city' ? 'text-textPrimary' : 'font-semibold text-textPrimary'}`}>{r.name}</span>
          <Badge label={r.kind === 'country' && r.isAppRegion ? 'app region' : r.kind} />
          {r.status === 'inactive' && <Badge label="inactive" tone="warning" />}
          {r.isFeatured && <Badge label="featured" tone="accent" />}
          <span className="hidden text-xs text-textMuted sm:inline">
            {[
              children.length > 0 ? `${children.length} ${r.kind === 'country' ? 'places' : 'cities'}` : null,
              r.currencyCodes?.length ? r.currencyCodes.join(' / ') : null,
              r.listingCount > 0 ? `${r.listingCount} listing${r.listingCount === 1 ? '' : 's'}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {r.status === 'approved' && r.kind === 'country' && (
            <Button size="sm" variant="outline" onClick={() => onAdd('region', r.id)}>
              + Region
            </Button>
          )}
          {r.status === 'approved' && r.kind !== 'city' && (
            <Button size="sm" variant="outline" onClick={() => onAdd('city', r.id)}>
              + City
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => onEdit(r)}>
            Edit
          </Button>
          {r.status === 'approved' ? (
            <Button size="sm" variant="danger" onClick={() => onDeactivate(r)}>
              Deactivate
            </Button>
          ) : (
            <Button size="sm" onClick={() => onReactivate(r)}>
              Reactivate
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => onDelete(r)}>
            Delete
          </Button>
        </div>
      </div>
    );
  };

  const shown = countries.filter(matches);
  if (shown.length === 0) return <EmptyState icon={MapPin} title="Nothing here" message="No matching locations." />;

  return (
    <div className="space-y-4">
      {shown.map((country) => {
        const regions = (kids.get(country.id) ?? []).filter((c) => c.kind === 'region' && matches(c));
        const directCities = (kids.get(country.id) ?? []).filter((c) => c.kind === 'city' && matches(c));
        return (
          <Card key={country.id} elevated={false} className="p-0">
            <div className="rounded-t-lg bg-inputBackground">{renderRow(country, 0)}</div>
            {isOpen(country) && (
              <div className="divide-y divide-border">
                {regions.length === 0 && directCities.length === 0 && <p className="px-4 py-3 text-sm text-textMuted">No regions or cities yet.</p>}
                {regions.map((region) => {
                  const cities = (kids.get(region.id) ?? []).filter(matches);
                  return (
                    <div key={region.id}>
                      {renderRow(region, 1)}
                      {isOpen(region) && cities.map((city) => renderRow(city, 3))}
                    </div>
                  );
                })}
                {directCities.map((city) => renderRow(city, 1))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/** How many places (the place itself plus everything below it) and linked listings a delete would affect. */
function subtreeStats(rows: AdminLocation[], rootId: string): { places: number; listings: number } {
  const kids = new Map<string, AdminLocation[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const list = kids.get(r.parentId) ?? [];
    list.push(r);
    kids.set(r.parentId, list);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  let places = 0;
  let listings = 0;
  const walk = (id: string) => {
    const r = byId.get(id);
    if (!r) return;
    places += 1;
    listings += r.listingCount;
    for (const c of kids.get(id) ?? []) walk(c.id);
  };
  walk(rootId);
  return { places, listings };
}
