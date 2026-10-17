'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { DashboardCounts, getDashboardCounts, getOverviewStats } from '@/services/admin';
import { useStaffCan } from '@/lib/staffRole';
import { formatRelativeTime } from '@/lib/time';

type Recent = Awaited<ReturnType<typeof getOverviewStats>>['recentlyReportedListings'];

// Every tile is a link into the matching, pre-filtered queue — numbers come from one server-side aggregate
// (admin_dashboard_counts), so the overview stays fast regardless of how many listings exist.
function StatTile({ label, value, href, urgent }: { label: string; value: number | undefined; href: string; urgent?: boolean }) {
  return (
    <Link href={href} className="block rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <Card elevated={false} className="flex h-full flex-col gap-1 transition-colors hover:bg-inputBackground">
        <p className="text-xs font-medium uppercase tracking-wide text-textMuted">{label}</p>
        <p className={`text-2xl font-bold ${urgent && value ? 'text-warning' : 'text-textPrimary'}`}>{value ?? '—'}</p>
      </Card>
    </Link>
  );
}

export default function AdminOverviewPage() {
  const [counts, setCounts] = useState<DashboardCounts | null | undefined>(undefined);
  const [recent, setRecent] = useState<Recent>([]);
  const canReports = useStaffCan('report_status');
  const canUsers = useStaffCan('warn');
  const canSupport = useStaffCan('support');

  useEffect(() => {
    getDashboardCounts().then(setCounts);
    getOverviewStats().then((s) => setRecent(s.recentlyReportedListings));
  }, []);

  return (
    <div>
      <h1 className="mb-5 text-2xl font-bold text-textPrimary">Overview</h1>

      {counts === undefined ? (
        <p className="text-sm text-textSecondary">Loading…</p>
      ) : counts === null ? (
        <p className="text-sm text-error" role="alert">
          Couldn’t load the overview. Check your connection and refresh.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {canReports && <StatTile label="Pending reports" value={counts.pending_reports} href="/admin/reports?status=pending" urgent />}
            {canReports && <StatTile label="Reviewing" value={counts.reviewing_reports} href="/admin/reports?status=reviewing" />}
            {canSupport && <StatTile label="Awaiting reply" value={counts.awaiting_staff_cases} href="/admin/support?status=awaiting_staff" urgent />}
            {canSupport && <StatTile label="Pending appeals" value={counts.pending_appeals} href="/admin/support?status=open" urgent />}
            <StatTile label="Live listings" value={counts.live_listings} href="/admin/listings?status=live" />
            <StatTile label="Removed / deactivated" value={counts.moderated_listings} href="/admin/listings?status=moderated" />
            {canUsers && <StatTile label="Suspended users" value={counts.suspended_users} href="/admin/users?status=suspended" />}
            {canUsers && <StatTile label="Banned users" value={counts.banned_users} href="/admin/users?status=banned" />}
            <StatTile label="Verified sellers" value={counts.verified_users} href="/admin/users?status=verified" />
            <StatTile label="Boosted now" value={counts.boosted_now} href="/admin/listings?boosted=1" />
          </div>

          <div className="mt-8">
            <h2 className="mb-3 text-lg font-semibold text-textPrimary">Recently reported listings</h2>
            {recent.length === 0 ? (
              <p className="text-sm text-textSecondary">No listings have been reported recently.</p>
            ) : (
              <Card elevated={false} className="divide-y divide-border p-0">
                {recent.map((l) => (
                  <Link key={l.id} href={`/admin/listings/${l.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-inputBackground">
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
