'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { History as HistoryIcon } from '@/lib/icons';
import { listAuditLog } from '@/services/admin';
import { AdminAuditLogEntry } from '@/lib/types';
import { formatRelativeTime } from '@/lib/time';

const ACTION_LABEL: Record<string, string> = {
  report_status_change: 'Updated report status',
  warn_user: 'Warned user',
  suspend_user: 'Suspended user',
  unsuspend_user: 'Unsuspended user',
  remove_listing: 'Removed listing',
  restore_listing: 'Restored listing',
};

export default function AdminHistoryPage() {
  const [entries, setEntries] = useState<AdminAuditLogEntry[] | null>(null);

  useEffect(() => {
    listAuditLog().then(setEntries);
  }, []);

  return (
    <div>
      <h1 className="mb-5 text-2xl font-bold text-textPrimary">Moderation history</h1>

      {!entries ? (
        <p className="text-sm text-textSecondary">Loading…</p>
      ) : entries.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No actions yet" message="Admin actions will show up here as they happen." />
      ) : (
        <Card elevated={false} className="divide-y divide-border p-0">
          {entries.map((e) => (
            <div key={e.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-textPrimary">{ACTION_LABEL[e.action] ?? e.action}</p>
                <Badge label={e.targetType} tone="neutral" />
              </div>
              {e.reason && <p className="mt-1 text-sm text-textSecondary">{e.reason}</p>}
              <p className="mt-1 text-xs text-textMuted">
                {e.adminName} · {formatRelativeTime(new Date(e.createdAt).getTime())}
              </p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
