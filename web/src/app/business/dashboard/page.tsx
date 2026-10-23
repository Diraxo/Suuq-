'use client';

// Web port of app/business/dashboard.tsx — the same entries, including Bulk upload (CSV import).
import Link from 'next/link';
import { BarChart3, Building2, ChevronRight, FileText, Settings } from '@/lib/icons';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { STOREFRONTS_ENABLED } from '@/lib/storefrontFlag';
import { useT } from '@/lib/i18n';

export default function BusinessDashboardPage() {
  const t = useT();
  const authed = useRequireAuthPage('/business/dashboard');
  if (!authed) return <div className="min-h-[50vh]" />;

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <PageHeader title={t('business.dashboard.title')} />
        <div className="mb-6 flex flex-col gap-3">
          <Link href="/business/analytics">
            <Card className="flex items-center gap-3">
              <BarChart3 size={20} className="text-primary" />
              <span className="flex-1 text-sm font-medium text-textPrimary">{t('business.analytics.title')}</span>
              <ChevronRight size={18} className="text-textMuted" />
            </Card>
          </Link>
          <Link href="/seller-dashboard">
            <Card className="flex items-center gap-3">
              <Building2 size={20} className="text-primary" />
              <span className="flex-1 text-sm font-medium text-textPrimary">{t('profile.menu.sellerDashboard')}</span>
              <ChevronRight size={18} className="text-textMuted" />
            </Card>
          </Link>
          <Link href={STOREFRONTS_ENABLED ? '/business/storefront' : '/settings'}>
            <Card className="flex items-center gap-3">
              <Settings size={20} className="text-primary" />
              <span className="flex-1 text-sm font-medium text-textPrimary">{t('business.dashboard.editStorefront')}</span>
              <ChevronRight size={18} className="text-textMuted" />
            </Card>
          </Link>
          <Link href="/business/bulk-upload">
            <Card className="flex items-center gap-3">
              <FileText size={20} className="text-primary" />
              <span className="flex-1 text-sm font-medium text-textPrimary">{t('business.dashboard.bulkUploadListings')}</span>
              <ChevronRight size={18} className="text-textMuted" />
            </Card>
          </Link>
        </div>

        <Card elevated={false} className="opacity-70">
          <div className="mb-1 flex items-center gap-2">
            <p className="flex-1 text-sm font-medium text-textPrimary">{t('business.dashboard.subscriptionPlans')}</p>
            <Badge label={t('business.dashboard.comingLater')} tone="neutral" />
          </div>
          <p className="text-xs text-textSecondary">{t('web.t.suuqiyeIsFreeDuringThe')}</p>
        </Card>
      </div>
    </div>
  );
}
