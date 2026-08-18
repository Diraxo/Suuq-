'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { getOverviewStats } from '@/services/admin';
import { formatRelativeTime } from '@/lib/time';

type Stats = Awaited<ReturnType<typeof getOverviewStats>>;

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card elevated={false} className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wide text-textMuted">{label}</p>
      <p className="text-2xl font-bold text-textPrimary">{value}</p>
    </Card>
  );
}

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    getOverviewStats().then(setStats);
  }, []);

  return (
    <div>
      <h1 className="mb-5 text-2xl font-bold text-textPrimary">Overview</h1>

      {!stats ? (
        <p className="text-sm text-textSecondary">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Pending reports" value={stats.pendingReports} />
            <StatTile label="Reviewing" value={stats.reviewingReports} />
            <StatTile label="Resolved reports" value={stats.resolvedReports} />
            <StatTile label="Active users" value={stats.activeUsers} />
            <StatTile label="Suspended users" value={stats.suspendedUsers} />
            <StatTile label="Active listings" value={stats.activeListings} />
          </div>

          <div className="mt-8">
            <h2 className="mb-3 text-lg font-semibold text-textPrimary">Recently reported listings</h2>
            {stats.recentlyReportedListings.length === 0 ? (
              <p className="text-sm text-textSecondary">No listings have been reported recently.</p>
            ) : (
              <Card elevated={false} className="divide-y divide-border p-0">
                {stats.recentlyReportedListings.map((l) => (
                  <Link key={l.id} href="/admin/reports" className="flex items-center justify-between px-4 py-3 text-sm hover:bg-inputBackground">
                    <span className="truncate text-textPrimary">{l.title}</span>
                    <span className="shrink-0 text-textMuted">{formatRelativeTime(new Date(l.createdAt).getTime())}</span>
                  </Link>
                ))}
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
