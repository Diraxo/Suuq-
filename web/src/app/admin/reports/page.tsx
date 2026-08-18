'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { Flag } from '@/lib/icons';
import { listReports } from '@/services/admin';
import { AdminReport, ReportStatus } from '@/lib/types';
import { formatRelativeTime } from '@/lib/time';

const STATUS_FILTERS: { label: string; value: ReportStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Reviewing', value: 'reviewing' },
  { label: 'Resolved', value: 'reviewed' },
  { label: 'Dismissed', value: 'dismissed' },
];

const STATUS_TONE: Record<ReportStatus, 'warning' | 'accent' | 'success' | 'neutral'> = {
  pending: 'warning',
  reviewing: 'accent',
  reviewed: 'success',
  dismissed: 'neutral',
};

const STATUS_LABEL: Record<ReportStatus, string> = {
  pending: 'Pending',
  reviewing: 'Reviewing',
  reviewed: 'Resolved',
  dismissed: 'Dismissed',
};

export default function AdminReportsPage() {
  const [filter, setFilter] = useState<ReportStatus | 'all'>('pending');
  const [reports, setReports] = useState<AdminReport[] | null>(null);

  useEffect(() => {
    setReports(null);
    listReports(filter === 'all' ? undefined : { status: filter }).then(setReports);
  }, [filter]);

  return (
    <div>
      <h1 className="mb-5 text-2xl font-bold text-textPrimary">Reports</h1>

      <div className="mb-5 flex gap-2 overflow-x-auto">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`whitespace-nowrap rounded-pill px-3 py-1.5 text-sm font-medium ${
              filter === f.value ? 'bg-primary text-primaryText' : 'bg-inputBackground text-textSecondary'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!reports ? (
        <p className="text-sm text-textSecondary">Loading…</p>
      ) : reports.length === 0 ? (
        <EmptyState icon={Flag} title="No reports" message="Nothing matches this filter right now." />
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map((r) => (
            <Link key={r.id} href={`/admin/reports/${r.id}`}>
              <Card className="transition-colors hover:bg-inputBackground">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-textPrimary">
                      {r.targetType === 'listing' ? 'Listing report' : r.targetType === 'user' ? 'User report' : 'Review report'} — {r.reason}
                    </p>
                    <p className="mt-1 text-xs text-textMuted">
                      Reported by {r.reporterName} · {formatRelativeTime(new Date(r.createdAt).getTime())}
                    </p>
                  </div>
                  <Badge label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
