'use client';

// Staff directory of ALL businesses (migration 0071, admin_list_businesses). Shows publication and verification as two separate states,
// the owning account (stable account id), active listings and open reports, and offers the existing authorized actions. Authorization is
// enforced by Postgres (staff_can('business_review'), admin only); the gate in the admin layout and this component are UX only.
// Verification documents are never shown here: they are only reachable from the audited review flow.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { AdminActionModal } from '@/components/AdminActionModal';
import { EmptyState } from '@/components/EmptyState';
import { ShieldCheck } from '@/lib/icons';
import { formatRelativeTime } from '@/lib/time';
import { useAuthStore } from '@/store/auth';
import {
  ACTION_COPY,
  BusinessFilters,
  BusinessListItem,
  PUBLICATION_LABEL,
  StaffAction,
  VERIFICATION_LABEL,
  businessActions,
  reasonOk,
} from '@/lib/storefrontAdmin';
import { listBusinesses, revokeStorefrontVerification, setStorefrontStatus } from '@/services/storefrontAdmin';

const PUBLICATION_TONE = { draft: 'neutral', published: 'success', suspended: 'warning' } as const;
const VERIFICATION_TONE = { not_requested: 'neutral', pending: 'warning', verified: 'success', rejected: 'neutral' } as const;
const STATUS_OPTIONS = [['', 'Any publication state'], ['published', 'Published'], ['draft', 'Not published'], ['suspended', 'Suspended']] as const;
const VERIFICATION_OPTIONS = [['', 'Any verification state'], ['pending', 'Verification pending'], ['verified', 'Verified'], ['not_requested', 'Not verified'], ['rejected', 'Verification rejected']] as const;
const SUCCESS_TEXT: Record<'suspend' | 'reinstate' | 'revoke', string> = { suspend: 'Storefront suspended.', reinstate: 'Storefront reinstated.', revoke: 'Verification removed.' };

type RowAction = Extract<StaffAction, 'suspend' | 'reinstate' | 'revoke'>;

export function AdminBusinessDirectory({ onReviewRequest }: { onReviewRequest: (requestId: string, businessName: string | null) => void }) {
  const staffId = useAuthStore((s) => s.session?.user.id ?? null);
  const [filters, setFilters] = useState<BusinessFilters>({ status: null, verification: null, search: '' });
  const [query, setQuery] = useState(''); // the search box; applied on submit so each keystroke is not a request
  const [rows, setRows] = useState<BusinessListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<RowAction | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setLoadError(null);
    const r = await listBusinesses(filters);
    if (r.error !== null) setLoadError(r.error);
    else setRows(r.data);
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = rows?.find((r) => r.storefrontId === selected) ?? null;

  const confirm = async (reason: string, extra: { message?: string }): Promise<{ error?: string }> => {
    if (!current || !dialog) return {};
    if (!reasonOk(reason)) return { error: 'Give a reason of at least 10 characters.' };
    const result =
      dialog === 'revoke'
        ? await revokeStorefrontVerification(current.storefrontId, reason, extra.message)
        : await setStorefrontStatus(current.storefrontId, dialog, reason, extra.message);
    if (result.error) return result;
    setFlash({ ok: true, text: SUCCESS_TEXT[dialog] });
    void load(); // the server decides the resulting state (e.g. reinstating restores whatever it was before suspension)
    return {};
  };

  const select = (id: string) => {
    setSelected((s) => (s === id ? null : id));
    setFlash(null);
  };

  return (
    <div>
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters((f) => ({ ...f, search: query }));
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Business, owner name or account id"
          aria-label="Search businesses"
          maxLength={100}
          className="min-w-[14rem] flex-1 rounded-md border border-border bg-inputBackground px-3 py-2 text-sm text-textPrimary"
        />
        <select
          aria-label="Publication state"
          value={filters.status ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, status: (e.target.value || null) as BusinessFilters['status'] }))}
          className="rounded-md border border-border bg-inputBackground px-3 py-2 text-sm text-textPrimary"
        >
          {STATUS_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="Verification state"
          value={filters.verification ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, verification: (e.target.value || null) as BusinessFilters['verification'] }))}
          className="rounded-md border border-border bg-inputBackground px-3 py-2 text-sm text-textPrimary"
        >
          {VERIFICATION_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="outline">
          Search
        </Button>
      </form>

      {flash && (
        <p className={`mb-3 rounded-md px-3 py-2 text-sm ${flash.ok ? 'bg-success/15 text-success' : 'bg-error/10 text-error'}`} role={flash.ok ? 'status' : 'alert'}>
          {flash.text}
        </p>
      )}

      {loadError ? (
        <div role="alert">
          <p className="text-sm text-error">Couldn’t load businesses: {loadError}</p>
          <div className="mt-3">
            <Button size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        </div>
      ) : !rows ? (
        <p className="text-sm text-textSecondary">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No businesses" message="No business matches these filters." />
      ) : (
        <Card elevated={false} className="divide-y divide-border p-0">
          {rows.map((b) => {
            const open = b.storefrontId === selected;
            const a = businessActions(b, staffId);
            return (
              <div key={b.storefrontId} className="px-4 py-3">
                <button type="button" onClick={() => select(b.storefrontId)} aria-expanded={open} className="flex w-full flex-wrap items-center justify-between gap-3 text-left">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-textPrimary">{b.businessName ?? b.ownerName ?? 'Unnamed business'}</span>
                      <Badge label={PUBLICATION_LABEL[b.status]} tone={PUBLICATION_TONE[b.status]} />
                      <Badge label={VERIFICATION_LABEL[b.verificationStatus]} tone={VERIFICATION_TONE[b.verificationStatus]} />
                      {b.ownerAccountStatus !== 'active' && <Badge label={`Owner ${b.ownerAccountStatus}`} tone="warning" />}
                    </div>
                    <p className="mt-0.5 text-xs text-textMuted">
                      {b.ownerName ?? 'Unnamed owner'} · {b.activeListings} active listing{b.activeListings === 1 ? '' : 's'} · {b.openUserReports + b.openListingReports} open report
                      {b.openUserReports + b.openListingReports === 1 ? '' : 's'}
                    </p>
                  </div>
                  <span className="text-xs text-textMuted">{open ? 'Hide' : 'Details'}</span>
                </button>

                {open && (
                  <div className="mt-3 border-t border-border pt-3">
                    <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
                      <dt className="text-textMuted">Owner</dt>
                      <dd className="text-textPrimary">
                        {b.ownerName ?? 'Unnamed owner'} ·{' '}
                        <Link href={`/admin/users/${b.ownerId}`} className="font-medium text-primary">
                          Open account
                        </Link>
                      </dd>
                      <dt className="text-textMuted">Account ID</dt>
                      <dd className="break-all font-mono text-xs text-textPrimary">{b.ownerId}</dd>
                      <dt className="text-textMuted">Owner account</dt>
                      <dd className="text-textPrimary capitalize">{b.ownerAccountStatus}</dd>
                      <dt className="text-textMuted">Publication</dt>
                      <dd className="text-textPrimary">
                        {PUBLICATION_LABEL[b.status]}
                        {b.status === 'published' && b.publishedAt ? ` · since ${formatRelativeTime(new Date(b.publishedAt).getTime())}` : ''}
                        {b.status === 'suspended' && b.suspendedAt ? ` · ${formatRelativeTime(new Date(b.suspendedAt).getTime())}` : ''}
                      </dd>
                      <dt className="text-textMuted">Verification</dt>
                      <dd className="text-textPrimary">
                        {VERIFICATION_LABEL[b.verificationStatus]}
                        {b.verificationStatus === 'verified' && b.verifiedAt ? ` · ${formatRelativeTime(new Date(b.verifiedAt).getTime())}` : ''}
                      </dd>
                      <dt className="text-textMuted">Active listings</dt>
                      <dd className="text-textPrimary">{b.activeListings}</dd>
                      <dt className="text-textMuted">Open reports</dt>
                      <dd className="text-textPrimary">
                        {b.openUserReports} on the account, {b.openListingReports} on listings ·{' '}
                        <Link href="/admin/reports" className="font-medium text-primary">
                          Open reports
                        </Link>
                      </dd>
                    </dl>

                    <p className="mt-3 text-xs text-textMuted">
                      Publication and verification are separate. Suspending hides the storefront but does not remove its verification; removing verification does not unpublish it.
                    </p>
                    {a.ownBusiness && <p className="mt-2 text-xs text-warning">This is your own business. Another admin has to review or moderate it.</p>}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {a.review && b.pendingRequestId && (
                        <Button size="sm" onClick={() => onReviewRequest(b.pendingRequestId as string, b.businessName)}>
                          Review verification request
                        </Button>
                      )}
                      {a.suspend && (
                        <Button size="sm" variant="outline" onClick={() => setDialog('suspend')}>
                          Suspend storefront
                        </Button>
                      )}
                      {a.reinstate && (
                        <Button size="sm" variant="outline" onClick={() => setDialog('reinstate')}>
                          Reinstate storefront
                        </Button>
                      )}
                      {a.revoke && (
                        <Button size="sm" variant="outline" onClick={() => setDialog('revoke')}>
                          Remove verification
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {dialog && current && (
        <AdminActionModal
          open
          title={`${ACTION_COPY[dialog].title}: ${current.businessName ?? current.ownerName ?? 'Unnamed business'}`}
          description={ACTION_COPY[dialog].description}
          confirmLabel={ACTION_COPY[dialog].confirm}
          danger={ACTION_COPY[dialog].danger}
          showMessage
          onConfirm={confirm}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
