'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { ListingStatusBadge } from '@/components/ListingStatusBadge';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { List } from '@/lib/icons';
import { AdminListingRow, listAdminListings } from '@/services/admin';
import { formatRelativeTime } from '@/lib/time';
import { formatBirr } from '@/lib/currency';
import { createLatestGuard } from '@/lib/refreshController';

const PAGE_SIZE = 25;
const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'live', label: 'Live (available + reserved)' },
  { value: 'moderated', label: 'Removed / deactivated' },
  { value: 'removed', label: 'Removed' },
  { value: 'deactivated', label: 'Deactivated' },
  { value: 'sold', label: 'Sold' },
  { value: 'expired', label: 'Expired' },
];

function ListingsInner() {
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [reportedOnly, setReportedOnly] = useState(params.get('reported') === '1');
  const [boostedOnly, setBoostedOnly] = useState(params.get('boosted') === '1');
  const [sort, setSort] = useState<'newest' | 'most_reported'>(params.get('sort') === 'most_reported' ? 'most_reported' : 'newest');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(query);
  const sellerId = params.get('sellerId');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminListingRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(createLatestGuard()).current;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(0), [status, reportedOnly, boostedOnly, sort, debounced]);

  useEffect(() => {
    const ticket = guard.next();
    setError(null);
    listAdminListings({ sellerId, status: status || null, reportedOnly: reportedOnly || sort === 'most_reported', boostedOnly, query: debounced, sort, page, pageSize: PAGE_SIZE }).then((r) => {
      if (!guard.isLatest(ticket)) return; // a newer filter/page was requested meanwhile
      if (r.error) setError(r.error);
      setRows(r.rows);
      setTotal(r.total);
    });
  }, [sellerId, status, reportedOnly, boostedOnly, sort, debounced, page]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-textPrimary">Listings</h1>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, seller name or email"
          className="w-full max-w-xs rounded-pill border border-border bg-inputBackground px-4 py-2 text-sm text-textPrimary outline-none focus:border-primary"
          aria-label="Search listings"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-border bg-inputBackground px-3 py-2 text-sm text-textPrimary" aria-label="Status">
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'most_reported')} className="rounded-md border border-border bg-inputBackground px-3 py-2 text-sm text-textPrimary" aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="most_reported">Most reported first</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-textSecondary">
          <input type="checkbox" checked={reportedOnly || sort === 'most_reported'} disabled={sort === 'most_reported'} onChange={(e) => setReportedOnly(e.target.checked)} />
          Reported only
        </label>
        <label className="flex items-center gap-2 text-sm text-textSecondary">
          <input type="checkbox" checked={boostedOnly} onChange={(e) => setBoostedOnly(e.target.checked)} />
          Boosted now
        </label>
      </div>

      {error && (
        <p className="mb-3 text-sm text-error" role="alert">
          {error}
        </p>
      )}

      {!rows ? (
        <p className="text-sm text-textSecondary">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={List} title="No listings" message="Nothing matches these filters." />
      ) : (
        <>
          <p className="mb-2 text-xs text-textMuted">
            {total.toLocaleString()} listing{total === 1 ? '' : 's'} · page {page + 1} of {pages}
          </p>
          <Card elevated={false} className="divide-y divide-border p-0">
            {rows.map((r) => (
              <Link key={r.listing.id} href={`/admin/listings/${r.listing.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-inputBackground">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-skeleton">
                  {r.listing.images?.[0] && <Image src={r.listing.images[0]} alt="" fill sizes="56px" className="object-cover" loading="lazy" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-textPrimary">{r.listing.title}</span>
                    <ListingStatusBadge status={r.listing.status} />
                    {r.open_report_count > 0 && <Badge label={`${r.open_report_count} open report${r.open_report_count === 1 ? '' : 's'}`} tone="warning" />}
                    {r.open_report_count === 0 && r.report_count > 0 && <Badge label={`${r.report_count} resolved`} tone="neutral" />}
                    {r.listing.boosted_until && new Date(r.listing.boosted_until) > new Date() && <Badge label="Boosted" tone="accent" />}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-textMuted">
                    {formatBirr(Number(r.listing.price), r.listing.currency)} · {r.seller.full_name ?? r.seller.email ?? 'SUUQIYE user'}
                    {r.seller.verified_at ? ' ✓' : ''}
                    {r.seller.account_status !== 'active' ? ` · ${r.seller.account_status}` : ''} · {formatRelativeTime(new Date(r.listing.created_at).getTime())}
                  </p>
                </div>
              </Link>
            ))}
          </Card>
          <div className="mt-4 flex items-center justify-between">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminListingsPage() {
  return (
    <Suspense>
      <ListingsInner />
    </Suspense>
  );
}
