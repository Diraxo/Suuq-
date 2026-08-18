'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { AdminActionModal } from '@/components/AdminActionModal';
import { EmptyState } from '@/components/EmptyState';
import { List } from '@/lib/icons';
import { listListingsForModeration, setListingStatus } from '@/services/admin';
import { formatRelativeTime } from '@/lib/time';

type Row = Awaited<ReturnType<typeof listListingsForModeration>>[number];

export default function AdminListingsPage() {
  const [reportedOnly, setReportedOnly] = useState(true);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [target, setTarget] = useState<Row | null>(null);

  const load = () => {
    setRows(null);
    listListingsForModeration({ reportedOnly }).then(setRows);
  };

  useEffect(load, [reportedOnly]);

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-textPrimary">Listings</h1>
        <label className="flex items-center gap-2 text-sm text-textSecondary">
          <input type="checkbox" checked={reportedOnly} onChange={(e) => setReportedOnly(e.target.checked)} />
          Reported only
        </label>
      </div>

      {!rows ? (
        <p className="text-sm text-textSecondary">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={List} title="No listings" message={reportedOnly ? 'No listings have been reported.' : 'No listings found.'} />
      ) : (
        <Card elevated={false} className="divide-y divide-border p-0">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Link href={`/listing/${r.id}`} className="truncate text-sm font-semibold text-textPrimary hover:text-primary">
                    {r.title}
                  </Link>
                  {r.status === 'removed' && <Badge label="Removed" tone="warning" />}
                  {r.reportCount > 0 && <Badge label={`${r.reportCount} report${r.reportCount === 1 ? '' : 's'}`} tone="accent" />}
                </div>
                <p className="mt-0.5 truncate text-xs text-textMuted">
                  {r.sellerName} · {formatRelativeTime(new Date(r.createdAt).getTime())}
                </p>
              </div>
              <Button variant={r.status === 'removed' ? 'primary' : 'danger'} size="sm" onClick={() => setTarget(r)}>
                {r.status === 'removed' ? 'Restore' : 'Remove'}
              </Button>
            </div>
          ))}
        </Card>
      )}

      <AdminActionModal
        open={target !== null}
        title={target?.status === 'removed' ? 'Restore listing' : 'Remove listing'}
        description={
          target?.status === 'removed'
            ? 'Makes this listing publicly visible again.'
            : 'Hides this listing from the marketplace immediately. It can be restored later.'
        }
        confirmLabel={target?.status === 'removed' ? 'Restore' : 'Remove'}
        danger={target?.status !== 'removed'}
        onClose={() => setTarget(null)}
        onConfirm={async (reason) => {
          if (!target) return {};
          const result = await setListingStatus(target.id, target.status === 'removed' ? 'available' : 'removed', reason);
          if (!result.error) load();
          return result;
        }}
      />
    </div>
  );
}
