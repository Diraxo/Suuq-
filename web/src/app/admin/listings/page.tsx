'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Badge } from '@/components/Badge';
import { ListingStatusBadge } from '@/components/ListingStatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { AdminAvatar } from '@/components/AdminAvatar';
import { AdminList, AdminListRow, AdminPageHeader, AdminPager, FilterChips, ListSkeleton } from '@/components/AdminUI';
import { List } from '@/lib/icons';
import { AdminListingRow, listAdminListings } from '@/services/admin';
import { formatRelativeTime } from '@/lib/time';
import { adminPriceText } from '@/lib/adminPrice';
import { resultLine, sentenceCase } from '@/lib/adminText';
import { createLatestGuard } from '@/lib/refreshController';

const PAGE_SIZE = 25;
const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'live', label: 'Live' },
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
    setRows(null);
    listAdminListings({ sellerId, status: status || null, reportedOnly: reportedOnly || sort === 'most_reported', boostedOnly, query: debounced, sort, page, pageSize: PAGE_SIZE }).then((r) => {
      if (!guard.isLatest(ticket)) return; // a newer filter/page was requested meanwhile
      if (r.error) setError(r.error);
      setRows(r.rows);
      setTotal(r.total);
    });
  }, [sellerId, status, reportedOnly, boostedOnly, sort, debounced, page]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const toggle = 'flex items-center gap-2 rounded-pill border border-border bg-surface px-3 py-1.5 text-sm text-textSecondary';

  return (
    <div>
      <AdminPageHeader title="Listings" description={sellerId ? 'Showing one seller’s listings.' : 'Every listing on the marketplace. Open one to review its photos, reports and seller.'} />

      <div className="mb-3">
        <FilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} label="Status" />
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, seller name or email"
          className="w-full max-w-xs rounded-pill border border-border bg-inputBackground px-4 py-2 text-sm text-textPrimary outline-none focus:border-primary"
          aria-label="Search listings"
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'most_reported')} className="rounded-pill border border-border bg-inputBackground px-3 py-2 text-sm text-textPrimary" aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="most_reported">Most reported first</option>
        </select>
        <label className={toggle}>
          <input type="checkbox" checked={reportedOnly || sort === 'most_reported'} disabled={sort === 'most_reported'} onChange={(e) => setReportedOnly(e.target.checked)} />
          Reported only
        </label>
        <label className={toggle}>
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
        <ListSkeleton label="Loading listings" />
      ) : rows.length === 0 ? (
        <EmptyState icon={List} title="No listings" message="Nothing matches these filters." />
      ) : (
        <>
          <AdminList>
            {rows.map((r) => {
              const boosted = r.listing.boosted_until && new Date(r.listing.boosted_until) > new Date();
              return (
                <AdminListRow
                  key={r.listing.id}
                  href={`/admin/listings/${r.listing.id}`}
                  lead={
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-skeleton">
                      {r.listing.images?.[0] && <Image src={r.listing.images[0]} alt="" fill sizes="56px" className="object-cover" loading="lazy" />}
                    </div>
                  }
                  title={r.listing.title}
                  badges={
                    <>
                      <ListingStatusBadge status={r.listing.status} />
                      {r.open_report_count > 0 && <Badge label={`${r.open_report_count} open report${r.open_report_count === 1 ? '' : 's'}`} tone="warning" />}
                      {r.open_report_count === 0 && r.report_count > 0 && <Badge label={`${r.report_count} resolved`} tone="neutral" />}
                      {boosted && <Badge label="Boosted" tone="accent" />}
                    </>
                  }
                  meta={
                    <>
                      <span className="font-medium text-textSecondary">{adminPriceText(r.listing.price, r.listing.currency)}</span>
                      {r.listing.category && <span>{sentenceCase(r.listing.category)}</span>}
                      {r.listing.city && <span>{r.listing.city}</span>}
                      <span className="inline-flex items-center gap-1">
                        <AdminAvatar name={r.seller.full_name ?? r.seller.email ?? 'S'} url={r.seller.avatar_url} size={16} />
                        {r.seller.full_name ?? r.seller.email ?? 'SUUQIYE user'}
                        {r.seller.verified_at ? ' ✓' : ''}
                      </span>
                      {r.seller.account_status !== 'active' && <Badge label={r.seller.account_status} tone="warning" />}
                      <span>{formatRelativeTime(new Date(r.listing.created_at).getTime())}</span>
                    </>
                  }
                />
              );
            })}
          </AdminList>
          <AdminPager summary={resultLine(total, 'listing', page, pages)} page={page} pages={pages} onPage={setPage} />
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
