'use client';

// Web port of app/business/analytics.tsx. Views / messages / items sold are queried for the chosen window;
// followers, listings and the top category / city are lifetime figures. Reloads live.
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { useLiveReload } from '@/hooks/useLiveReload';
import { useAuthStore } from '@/store/auth';
import {
  getItemsSoldSince,
  getListingViewsSince,
  getMessagesReceivedSince,
  getSellerStats,
  getTopCategoryAndCity,
  SellerStats,
  TopBreakdown,
} from '@/services/profile';
import { useT } from '@/lib/i18n';

const EMPTY: SellerStats = { listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 };

export default function BusinessAnalyticsPage() {
  const t = useT();
  const authed = useRequireAuthPage('/business/analytics');
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const [range, setRange] = useState<'weekly' | 'monthly'>('weekly');
  const [lifetime, setLifetime] = useState<SellerStats>(EMPTY);
  const [windowed, setWindowed] = useState({ views: 0, messages: 0, sold: 0 });
  const [top, setTop] = useState<{ topCategory: TopBreakdown; topCity: TopBreakdown }>({ topCategory: null, topCity: null });

  const load = useCallback(() => {
    if (!userId) return;
    const since = new Date(Date.now() - (range === 'weekly' ? 7 : 30) * 24 * 60 * 60 * 1000);
    void Promise.all([
      getSellerStats(userId),
      getTopCategoryAndCity(userId),
      getListingViewsSince(userId, since),
      getMessagesReceivedSince(userId, since),
      getItemsSoldSince(userId, since),
    ]).then(([stats, breakdown, views, messages, sold]) => {
      setLifetime(stats);
      setTop(breakdown);
      setWindowed({ views, messages, sold });
    });
  }, [userId, range]);

  useEffect(load, [load]);
  useLiveReload(userId, [
    { table: 'listings', filter: `user_id=eq.${userId}` },
    { table: 'followers', filter: `following_id=eq.${userId}` },
    { table: 'listing_view_events', filter: `seller_id=eq.${userId}` },
  ], load);

  if (!authed) return <div className="min-h-[50vh]" />;

  const metrics = [
    [t('business.analytics.totalViews'), windowed.views],
    [t('business.analytics.messages'), windowed.messages],
    [t('business.analytics.itemsSold'), windowed.sold],
    [t('settings.notificationPreferences.categories.followers.label'), lifetime.followers],
    [t('business.analytics.listings'), lifetime.listingsCount],
    [t('business.analytics.topCategory'), top.topCategory?.label ?? '—'],
    [t('business.analytics.topCity'), top.topCity?.label ?? '—'],
  ];

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <PageHeader title={t('business.analytics.title')} fallbackHref="/business/dashboard" />
        <div className="mb-3 flex gap-2">
          {(['weekly', 'monthly'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-pill px-3 py-1.5 text-sm font-medium capitalize ${range === r ? 'bg-primary text-primaryText' : 'bg-surface text-textSecondary shadow-sm'}`}
            >
              {r}
            </button>
          ))}
        </div>
        <p className="mb-3 text-xs text-textMuted">
          {t('business.analytics.summary', { days: range === 'weekly' ? 7 : 30 })}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {metrics.map(([label, value]) => (
            <Card key={label as string}>
              <p className="truncate text-2xl font-bold text-primary">{value}</p>
              <p className="text-xs text-textSecondary">{label}</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
