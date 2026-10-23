'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { MessageSquare } from '@/lib/icons';
import { AdminCaseRow, listAdminCases } from '@/services/admin';
import { formatRelativeTime } from '@/lib/time';
import { createLatestGuard } from '@/lib/refreshController';

const PAGE_SIZE = 25;
const FILTERS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'awaiting_staff', label: 'Awaiting us' },
  { value: 'awaiting_user', label: 'Awaiting seller' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const TONE: Record<string, 'warning' | 'accent' | 'success' | 'neutral'> = {
  awaiting_staff: 'warning',
  awaiting_user: 'accent',
  resolved: 'success',
  closed: 'neutral',
};
const LABEL: Record<string, string> = { awaiting_staff: 'Awaiting us', awaiting_user: 'Awaiting seller', resolved: 'Resolved', closed: 'Closed' };

function SupportInner() {
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminCaseRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(createLatestGuard()).current;

  useEffect(() => setPage(0), [status]);
  useEffect(() => {
    const ticket = guard.next();
    setError(null);
    listAdminCases(status || null, page, PAGE_SIZE).then((r) => {
      if (!guard.isLatest(ticket)) return;
      if (r.error) setError(r.error);
      setRows(r.rows);
      setTotal(r.total);
    });
  }, [status, page]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-textPrimary">Support</h1>
      <div className="mb-4 flex gap-2 overflow-x-auto" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatus(f.value)}
            aria-pressed={status === f.value}
            className={`whitespace-nowrap rounded-pill px-3 py-1.5 text-sm font-medium ${status === f.value ? 'bg-primary text-primaryText' : 'bg-inputBackground text-textSecondary'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-3 text-sm text-error" role="alert">
          {error}
        </p>
      )}
      {!rows ? (
        <p className="text-sm text-textSecondary">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No cases" message="Nothing matches this filter." />
      ) : (
        <>
          <p className="mb-2 text-xs text-textMuted">
            {total.toLocaleString()} case{total === 1 ? '' : 's'} · page {page + 1} of {pages}
          </p>
          <Card elevated={false} className="divide-y divide-border p-0">
            {rows.map((c) => (
              <Link key={c.id} href={`/admin/support/${c.id}`} className="block px-4 py-3 hover:bg-inputBackground">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-textPrimary">{c.subject}</span>
                  <Badge label={LABEL[c.status] ?? c.status} tone={TONE[c.status] ?? 'neutral'} />
                  {c.appeal_id && <Badge label={`Appeal · ${c.appeal_status}`} tone={c.appeal_status === 'pending' ? 'warning' : 'neutral'} />}
                </div>
                <p className="mt-0.5 truncate text-xs text-textMuted">
                  {c.user_name} · {formatRelativeTime(new Date(c.last_message_at).getTime())}
                </p>
                {c.last_snippet && <p className="mt-1 truncate text-sm text-textSecondary">{c.last_snippet}</p>}
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

export default function AdminSupportPage() {
  return (
    <Suspense>
      <SupportInner />
    </Suspense>
  );
}
