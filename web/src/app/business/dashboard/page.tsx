'use client';

// Web port of app/business/dashboard.tsx. Bulk upload needs the phone's photo picker and the on-device photo
// checks, so on the web it points people to the app instead of offering a screen that cannot finish the job.
import Link from 'next/link';
import { BarChart3, Building2, ChevronRight, Settings } from '@/lib/icons';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';

export default function BusinessDashboardPage() {
  const authed = useRequireAuthPage('/business/dashboard');
  if (!authed) return <div className="min-h-[50vh]" />;

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Business Dashboard" />
        <div className="mb-6 flex flex-col gap-3">
          <Link href="/business/analytics">
            <Card className="flex items-center gap-3">
              <BarChart3 size={20} className="text-primary" />
              <span className="flex-1 text-sm font-medium text-textPrimary">Analytics</span>
              <ChevronRight size={18} className="text-textMuted" />
            </Card>
          </Link>
          <Link href="/seller-dashboard">
            <Card className="flex items-center gap-3">
              <Building2 size={20} className="text-primary" />
              <span className="flex-1 text-sm font-medium text-textPrimary">Seller dashboard</span>
              <ChevronRight size={18} className="text-textMuted" />
            </Card>
          </Link>
          <Link href="/settings">
            <Card className="flex items-center gap-3">
              <Settings size={20} className="text-primary" />
              <span className="flex-1 text-sm font-medium text-textPrimary">Edit storefront</span>
              <ChevronRight size={18} className="text-textMuted" />
            </Card>
          </Link>
          <Card elevated={false} className="text-sm text-textSecondary">
            <span className="font-medium text-textPrimary">Bulk upload</span> — upload many listings from a CSV in the SUUQIYE app on your phone.
          </Card>
        </div>

        <Card elevated={false} className="opacity-70">
          <div className="mb-1 flex items-center gap-2">
            <p className="flex-1 text-sm font-medium text-textPrimary">Subscription plans</p>
            <Badge label="Coming later" tone="neutral" />
          </div>
          <p className="text-xs text-textSecondary">SUUQIYE is free during the first year. Paid business plans may be added later.</p>
        </Card>
      </div>
    </div>
  );
}
