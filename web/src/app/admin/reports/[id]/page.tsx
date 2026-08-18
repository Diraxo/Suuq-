'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { AdminActionModal } from '@/components/AdminActionModal';
import { getReportDetail, getReportTarget, setListingStatus, updateReportStatus } from '@/services/admin';
import { AdminReport, Listing, Profile, ReportStatus } from '@/lib/types';
import { formatRelativeTime } from '@/lib/time';

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

const NEXT_STEPS: Record<ReportStatus, { label: string; next: ReportStatus; danger?: boolean }[]> = {
  pending: [
    { label: 'Start reviewing', next: 'reviewing' },
    { label: 'Dismiss', next: 'dismissed', danger: true },
  ],
  reviewing: [
    { label: 'Resolve', next: 'reviewed' },
    { label: 'Dismiss', next: 'dismissed', danger: true },
  ],
  reviewed: [{ label: 'Reopen', next: 'reviewing' }],
  dismissed: [{ label: 'Reopen', next: 'reviewing' }],
};

export default function AdminReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [report, setReport] = useState<AdminReport | null | undefined>(undefined);
  const [target, setTarget] = useState<{ listing?: Pick<Listing, 'id' | 'title' | 'images'>; user?: Pick<Profile, 'id' | 'full_name' | 'email' | 'account_status'> } | null>(null);
  const [pendingStatus, setPendingStatus] = useState<ReportStatus | null>(null);
  const [showRemoveListing, setShowRemoveListing] = useState(false);

  const load = () => {
    getReportDetail(id).then((r) => {
      setReport(r);
      if (r) getReportTarget(r.targetType, r.targetId).then(setTarget);
    });
  };

  useEffect(load, [id]);

  if (report === undefined) return <p className="text-sm text-textSecondary">Loading…</p>;
  if (report === null) return <p className="text-sm text-textSecondary">Report not found.</p>;

  return (
    <div>
      <Link href="/admin/reports" className="mb-4 inline-block text-sm text-primary">
        ← Back to Reports
      </Link>
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-textPrimary">Report detail</h1>
        <Badge label={STATUS_LABEL[report.status]} tone={STATUS_TONE[report.status]} />
      </div>

      <Card className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-textMuted">Reason</p>
        <p className="mt-1 text-sm text-textPrimary">{report.reason}</p>
        {report.details && (
          <>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-textMuted">Details</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-textPrimary">{report.details}</p>
          </>
        )}
        <p className="mt-3 text-xs text-textMuted">
          Filed by {report.reporterName} · {formatRelativeTime(new Date(report.createdAt).getTime())}
        </p>
      </Card>

      <Card className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-textMuted">Reported {report.targetType}</p>
        {report.targetType === 'listing' && target?.listing ? (
          <div className="mt-2 flex items-center justify-between gap-3">
            <Link href={`/listing/${target.listing.id}`} className="truncate text-sm text-primary">
              {target.listing.title}
            </Link>
            <Button variant="danger" size="sm" onClick={() => setShowRemoveListing(true)}>
              Remove listing
            </Button>
          </div>
        ) : report.targetType === 'user' && target?.user ? (
          <div className="mt-2 flex items-center justify-between gap-3">
            <Link href={`/admin/users/${target.user.id}`} className="truncate text-sm text-primary">
              {target.user.full_name ?? target.user.email ?? target.user.id}
            </Link>
            {target.user.account_status === 'suspended' && <Badge label="Suspended" tone="warning" />}
          </div>
        ) : (
          <p className="mt-1 text-sm text-textSecondary">Target is no longer available (deleted or removed).</p>
        )}
      </Card>

      <div className="mt-5 flex flex-wrap gap-3">
        {NEXT_STEPS[report.status].map((step) => (
          <Button key={step.next} variant={step.danger ? 'danger' : 'primary'} size="sm" onClick={() => setPendingStatus(step.next)}>
            {step.label}
          </Button>
        ))}
      </div>

      <AdminActionModal
        open={pendingStatus !== null}
        title={pendingStatus ? `${NEXT_STEPS[report.status].find((s) => s.next === pendingStatus)?.label ?? 'Update status'}` : ''}
        description="This note is recorded in the moderation audit log."
        confirmLabel="Confirm"
        danger={pendingStatus === 'dismissed'}
        requireReason={false}
        onClose={() => setPendingStatus(null)}
        onConfirm={async (note) => {
          if (!pendingStatus) return {};
          const result = await updateReportStatus(report.id, pendingStatus, note || undefined);
          if (!result.error) load();
          return result;
        }}
      />

      {target?.listing && (
        <AdminActionModal
          open={showRemoveListing}
          title="Remove listing"
          description="Hides this listing from the marketplace. It can be restored later from the Listings page."
          confirmLabel="Remove listing"
          danger
          onClose={() => setShowRemoveListing(false)}
          onConfirm={async (reason) => {
            const result = await setListingStatus(target.listing!.id, 'removed', reason);
            return result;
          }}
        />
      )}
    </div>
  );
}
