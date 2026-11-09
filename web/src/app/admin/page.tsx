'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { AdminList, AdminListRow, AdminPageHeader } from '@/components/AdminUI';
import { DashboardCounts, getDashboardCounts, getOverviewStats } from '@/services/admin';
import { useStaffCan } from '@/lib/staffRole';
import { formatRelativeTime } from '@/lib/time';

type Recent = Awaited<ReturnType<typeof getOverviewStats>>['recentlyReportedListings'];

// Every tile is a link into the matching, pre-filtered queue — numbers come from one server-side aggregate
// (admin_dashboard_counts), so the overview stays fast regardless of how many listings exist.
function StatTile({ label, value, href, urgent }: { label: string; value: number | undefined; href: string; urgent?: boolean }) {
  const hot = !!urgent && !!value;
  return (
    <Link href={href} className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <Card elevated={false} className={`flex h-full flex-col gap-1 transition-colors hover:bg-inputBackground ${hot ? 'border-warning/50' : ''}`}>
        <p className="text-xs font-medium uppercase tracking-wide text-textMuted">{label}</p>
        <p className={`text-3xl font-bold ${hot ? 'text-warning' : 'text-textPrimary'}`}>{value === undefined ? '—' : value.toLocaleString('en-US')}</p>
      </Card>
    </Link>
  );
}

function TileGrid({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textMuted">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
    </section>
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
      <AdminPageHeader title="Overview" description="What needs attention first, and how the marketplace looks right now." />

      {counts === undefined ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading overview">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-lg bg-inputBackground" />
          ))}
        </div>
      ) : counts === null ? (
        <p className="text-sm text-error" role="alert">
          Couldn’t load the overview. Check your connection and refresh.
        </p>
      ) : (
        <>
          {(canReports || canSupport) && (
            <TileGrid title="Needs attention">
              {canReports && <StatTile label="Pending reports" value={counts.pending_reports} href="/admin/reports?status=pending" urgent />}
              {canReports && <StatTile label="Under review" value={counts.reviewing_reports} href="/admin/reports?status=reviewing" />}
              {canSupport && <StatTile label="Awaiting reply" value={counts.awaiting_staff_cases} href="/admin/support?status=awaiting_staff" urgent />}
              {canSupport && <StatTile label="Pending appeals" value={counts.pending_appeals} href="/admin/support?status=open" urgent />}
            </TileGrid>
          )}

          <TileGrid title="Marketplace">
            <StatTile label="Live listings" value={counts.live_listings} href="/admin/listings?status=live" />
            <StatTile label="Removed / deactivated" value={counts.moderated_listings} href="/admin/listings?status=moderated" />
            <StatTile label="Boosted now" value={counts.boosted_now} href="/admin/listings?boosted=1" />
            <StatTile label="Verified sellers" value={counts.verified_users} href="/admin/users?status=verified" />
            {canUsers && <StatTile label="Suspended users" value={counts.suspended_users} href="/admin/users?status=suspended" />}
            {canUsers && <StatTile label="Banned users" value={counts.banned_users} href="/admin/users?status=banned" />}
          </TileGrid>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-textMuted">Recently reported listings</h2>
            {recent.length === 0 ? (
              <Card elevated={false}>
                <p className="text-sm text-textSecondary">No listings have been reported recently.</p>
              </Card>
            ) : (
              <AdminList>
                {recent.map((l) => (
                  <AdminListRow key={l.id} href={`/admin/listings/${l.id}`} title={l.title} meta={<span>Reported {formatRelativeTime(new Date(l.createdAt).getTime())}</span>} />
                ))}
              </AdminList>
            )}
          </section>
        </>
      )}
    </div>
  );
}
