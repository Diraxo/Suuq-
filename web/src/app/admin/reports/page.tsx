'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorNotice } from '@/components/ErrorNotice';
import { AdminAvatar } from '@/components/AdminAvatar';
import { Flag } from '@/lib/icons';
import { getReportQueue, ReportQueueRow } from '@/services/admin';
import { ReportStatus, ReportTargetType } from '@/lib/types';
import { toAppError } from '@/lib/errors';
import { formatRelativeTime } from '@/lib/time';
import { REPORT_STATUS_LABEL, REPORT_STATUS_TONE, REPORT_TYPE_LABEL, reportRef } from '@/lib/reportUi';

const PAGE_SIZE = 20;

const STATUS_FILTERS: { label: string; value: ReportStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Under review', value: 'reviewing' },
  { label: 'Resolved', value: 'reviewed' },
  { label: 'Dismissed', value: 'dismissed' },
];

const TYPE_FILTERS: { label: string; value: ReportTargetType | 'all' }[] = [
  { label: 'All types', value: 'all' },
  { label: 'Listings', value: 'listing' },
  { label: 'Users', value: 'user' },
  { label: 'Reviews', value: 'review' },
];

// Local-date inputs -> an inclusive-from / exclusive-to UTC range (end date covers the whole day).
function dayStartIso(d: string) {
  return d ? new Date(`${d}T00:00:00`).toISOString() : null;
}
function dayEndIso(d: string) {
  if (!d) return null;
  const t = new Date(`${d}T00:00:00`);
  t.setDate(t.getDate() + 1);
  return t.toISOString();
}

export default function AdminReportsPage() {
  const [status, setStatus] = useState<ReportStatus | 'all'>('pending');
  const [type, setType] = useState<ReportTargetType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ReportQueueRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const requestId = useRef(0);

  // Deep link from the overview tiles: /admin/reports?status=reviewing
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('status');
    if (wanted && STATUS_FILTERS.some((f) => f.value === wanted)) setStatus(wanted as ReportStatus | 'all');
  }, []);

  // Debounce the free-text search so every keystroke is not a server round trip.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const mine = ++requestId.current;
    setRows(null);
    setError(null);
    const res = await getReportQueue({
      status: status === 'all' ? null : status,
      targetType: type === 'all' ? null : type,
      query,
      from: dayStartIso(from),
      to: dayEndIso(to),
      page,
      pageSize: PAGE_SIZE,
    });
    if (mine !== requestId.current) return; // a newer filter change superseded this response
    if (res.error) {
      setError(new Error(res.error));
      setRows([]);
      return;
    }
    setRows(res.rows);
    setTotal(res.total);
  }, [status, type, query, from, to, page]);

  useEffect(() => {
    load();
  }, [load]);

  const changeFilter = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(0);
  };
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="mb-5 text-2xl font-bold text-textPrimary">Reports</h1>

      <div className="mb-3 flex gap-2 overflow-x-auto">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => changeFilter(setStatus)(f.value)}
            className={`whitespace-nowrap rounded-pill px-3 py-1.5 text-sm font-medium ${
              status === f.value ? 'bg-primary text-primaryText' : 'bg-inputBackground text-textSecondary'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reason, user, listing title or report #"
          aria-label="Search reports"
          className="rounded-md border border-border bg-inputBackground p-2 text-sm text-textPrimary outline-none focus:border-primary"
        />
        <select
          value={type}
          onChange={(e) => changeFilter(setType)(e.target.value as ReportTargetType | 'all')}
          aria-label="Report type"
          className="rounded-md border border-border bg-inputBackground p-2 text-sm text-textPrimary"
        >
          {TYPE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-textSecondary">
          From
          <input type="date" value={from} onChange={(e) => changeFilter(setFrom)(e.target.value)} className="rounded-md border border-border bg-inputBackground p-2 text-sm text-textPrimary" />
        </label>
        <label className="flex items-center gap-2 text-xs text-textSecondary">
          To
          <input type="date" value={to} onChange={(e) => changeFilter(setTo)(e.target.value)} className="rounded-md border border-border bg-inputBackground p-2 text-sm text-textPrimary" />
        </label>
      </div>

      {rows === null ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading reports">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-inputBackground" />
          ))}
        </div>
      ) : error ? (
        <ErrorNotice error={toAppError(error)} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Flag} title="No reports" message="Nothing matches these filters right now." />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <Link key={r.id} href={`/admin/reports/${r.id}`}>
                <Card className="transition-colors hover:bg-inputBackground">
                  <div className="flex items-start gap-3">
                    {r.listing && (
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-inputBackground">
                        {r.listing.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.listing.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-textMuted">No image</span>
                        )}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-mono text-textMuted">{reportRef(r.id)}</span>
                        <Badge label={REPORT_TYPE_LABEL[r.target_type]} tone="neutral" />
                        {r.target_report_count > 1 && <Badge label={`${r.target_report_count} reports on this target`} tone="warning" />}
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-textPrimary">{r.reason}</p>
                      {r.listing && (
                        <p className="truncate text-xs text-textSecondary">
                          {r.listing.title ?? 'Untitled listing'}
                          {!r.listing.available && ' · listing deleted'}
                          {r.listing.available && r.listing.status && ['removed', 'deactivated'].includes(r.listing.status) && ` · ${r.listing.status}`}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-textMuted">
                        <span className="flex items-center gap-1.5">
                          <AdminAvatar name={r.reporter.name} url={r.reporter.avatar_url} size={20} />
                          Reporter: <span className="text-textSecondary">{r.reporter.name}</span>
                        </span>
                        {r.reported_user && (
                          <span className="flex items-center gap-1.5">
                            <AdminAvatar name={r.reported_user.name} url={r.reported_user.avatar_url} size={20} />
                            Reported: <span className="text-textSecondary">{r.reported_user.name}</span>
                          </span>
                        )}
                        <span>{formatRelativeTime(new Date(r.created_at).getTime())}</span>
                        {r.assigned_to && <span>Reviewer: {r.assigned_to.name}</span>}
                      </div>
                    </div>
                    <Badge label={REPORT_STATUS_LABEL[r.status]} tone={REPORT_STATUS_TONE[r.status]} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>

          <div className="mt-5 flex items-center justify-between text-sm text-textSecondary">
            <span>
              {total} report{total === 1 ? '' : 's'} · page {page + 1} of {pageCount}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
