'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { AdminList, AdminListRow, AdminPageHeader, AdminPager, FilterChips, ListSkeleton } from '@/components/AdminUI';
import { MessageSquare } from '@/lib/icons';
import { AdminCaseRow, listAdminCases } from '@/services/admin';
import { formatRelativeTime } from '@/lib/time';
import { resultLine, sentenceCase } from '@/lib/adminText';
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
const LABEL: Record<string, string> = { open: 'Open', awaiting_staff: 'Awaiting us', awaiting_user: 'Awaiting seller', resolved: 'Resolved', closed: 'Closed' };

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
    setRows(null);
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
      <AdminPageHeader title="Support" description="Conversations and appeals from sellers. “Awaiting us” cases are waiting for a reply from staff." />
      <div className="mb-5">
        <FilterChips options={FILTERS} value={status} onChange={setStatus} label="Filter" />
      </div>

      {error && (
        <p className="mb-3 text-sm text-error" role="alert">
          {error}
        </p>
      )}
      {!rows ? (
        <ListSkeleton label="Loading cases" />
      ) : rows.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No cases" message="Nothing matches this filter." />
      ) : (
        <>
          <AdminList>
            {rows.map((c) => (
              <AdminListRow
                key={c.id}
                href={`/admin/support/${c.id}`}
                title={c.subject}
                badges={
                  <>
                    <Badge label={LABEL[c.status] ?? sentenceCase(c.status)} tone={TONE[c.status] ?? 'neutral'} />
                    {c.appeal_id && <Badge label={`Appeal · ${sentenceCase(c.appeal_status ?? '')}`} tone={c.appeal_status === 'pending' ? 'warning' : 'neutral'} />}
                  </>
                }
                meta={
                  <>
                    <span className="font-medium text-textSecondary">{c.user_name}</span>
                    <span>{formatRelativeTime(new Date(c.last_message_at).getTime())}</span>
                  </>
                }
                snippet={c.last_snippet}
              />
            ))}
          </AdminList>
          <AdminPager summary={resultLine(total, 'case', page, pages)} page={page} pages={pages} onPage={setPage} />
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
