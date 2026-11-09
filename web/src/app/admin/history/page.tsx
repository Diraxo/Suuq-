'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { AdminAvatar } from '@/components/AdminAvatar';
import { AdminList, AdminPageHeader, ListSkeleton } from '@/components/AdminUI';
import { History as HistoryIcon } from '@/lib/icons';
import { listAuditLog } from '@/services/admin';
import { AdminAuditLogEntry } from '@/lib/types';
import { formatRelativeTime } from '@/lib/time';
import { auditActionLabel, cappedNotice, targetLabel } from '@/lib/adminText';

const LOG_LIMIT = 100; // listAuditLog() default

export default function AdminHistoryPage() {
  const [entries, setEntries] = useState<AdminAuditLogEntry[] | null>(null);

  useEffect(() => {
    listAuditLog(LOG_LIMIT).then(setEntries);
  }, []);

  const capped = entries ? cappedNotice(entries.length, LOG_LIMIT, 'action') : null;

  return (
    <div>
      <AdminPageHeader title="Moderation history" description="Every action staff have taken, newest first, with who did it and why." />

      {!entries ? (
        <ListSkeleton label="Loading history" />
      ) : entries.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No actions yet" message="Admin actions will show up here as they happen." />
      ) : (
        <>
          <AdminList>
            {entries.map((e) => (
              <div key={e.id} className="flex items-start gap-3 px-4 py-3">
                <AdminAvatar name={e.adminName} url={null} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-semibold text-textPrimary">{auditActionLabel(e.action)}</p>
                    <Badge label={targetLabel(e.targetType)} tone="neutral" />
                  </div>
                  {e.reason && <p className="mt-1 break-words text-sm text-textSecondary">{e.reason}</p>}
                  <p className="mt-1 text-xs text-textMuted">
                    {e.adminName} · {formatRelativeTime(new Date(e.createdAt).getTime())}
                  </p>
                </div>
              </div>
            ))}
          </AdminList>
          {capped && <p className="mt-3 text-sm text-textSecondary">{capped}</p>}
        </>
      )}
    </div>
  );
}
