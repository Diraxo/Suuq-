'use client';

// Web port of app/price-drops.tsx: the signed-in seller's discounts running now, then earlier price reductions.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TrendingDown } from '@/lib/icons';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { useLiveReload } from '@/hooks/useLiveReload';
import { useAuthStore } from '@/store/auth';
import { formatBirr } from '@/lib/currency';
import { isContactPriceListing } from '@/lib/serviceConfig';
import { activeDiscount, discountEndsText } from '@/lib/discount';
import { Listing } from '@/lib/types';
import { listMyListings, listPriceDrops, PriceDrop } from '@/services/listings';
import { useT } from '@/lib/i18n';

export default function PriceDropsPage() {
  const t = useT();
  const authed = useRequireAuthPage('/price-drops');
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const [running, setRunning] = useState<Listing[]>([]);
  const [earlier, setEarlier] = useState<{ listing: Listing; drop: PriceDrop }[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    if (!userId) return;
    listMyListings(userId)
      .then(async (listings) => {
        const live = listings.filter((l) => activeDiscount(l));
        const liveIds = new Set(live.map((l) => l.id));
        const drops = await listPriceDrops(listings.map((l) => l.id));
        const byId = new Map(listings.map((l) => [l.id, l]));
        // Newest drop per listing, as on the app; a listing with a discount running is shown above instead.
        const seen = new Set<string>();
        const out: { listing: Listing; drop: PriceDrop }[] = [];
        for (const d of drops) {
          const listing = byId.get(d.listingId);
          if (!listing || seen.has(d.listingId) || liveIds.has(d.listingId) || isContactPriceListing(listing)) continue;
          seen.add(d.listingId);
          out.push({ listing, drop: d });
        }
        setRunning(live);
        setEarlier(out);
      })
      .finally(() => setLoaded(true));
  }, [userId]);

  useEffect(load, [load]);
  useLiveReload(userId, [{ table: 'listings', filter: `user_id=eq.${userId}` }], load);

  if (!authed) return <div className="min-h-[50vh]" />;

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <PageHeader title={t('settings.notificationPreferences.categories.priceDrops.label')} />
        {!loaded ? (
          <p className="py-10 text-center text-sm text-textSecondary">{t('common.loading')}</p>
        ) : running.length === 0 && earlier.length === 0 ? (
          <EmptyState icon={TrendingDown} title={t('web.t.noPriceDropsYet')} message={t('web.t.whenYouLowerThePrice')} />
        ) : (
          <div className="flex flex-col gap-3">
            {running.length > 0 && <p className="text-sm font-medium text-textMuted">{t('discount.runningNow')}</p>}
            {running.map((listing) => {
              const d = activeDiscount(listing)!;
              const ends = discountEndsText(d, t);
              return (
                <Link key={listing.id} href={`/listing/${listing.id}`}>
                  <Card>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-textPrimary">{listing.title}</p>
                      <Badge label={t('components.listingCard.discountOff', { percent: d.percent })} tone="sale" />
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                      <span className="text-base font-bold text-success">{formatBirr(listing.price, listing.currency)}</span>
                      <span className="text-xs text-textMuted line-through">{formatBirr(d.originalPrice, listing.currency)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-textMuted">{t('listing.discountSave', { amount: formatBirr(d.originalPrice - listing.price, listing.currency) })}</p>
                    {ends && <p className="mt-1 text-xs text-textSecondary">{ends}</p>}
                    {d.note && <p className="mt-1 text-xs text-textPrimary">{d.note}</p>}
                  </Card>
                </Link>
              );
            })}
            {earlier.length > 0 && <p className="mt-1 text-sm font-medium text-textMuted">{t('discount.earlierReductions')}</p>}
            {earlier.map(({ listing, drop }) => {
              const pct = drop.oldPrice > 0 ? Math.round((1 - listing.price / drop.oldPrice) * 100) : 0;
              return (
                <Link key={listing.id} href={`/listing/${listing.id}`}>
                  <Card className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-textPrimary">{listing.title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs text-textMuted line-through">{formatBirr(drop.oldPrice, listing.currency)}</span>
                        <span className="text-base font-bold text-success">{formatBirr(listing.price, listing.currency)}</span>
                      </div>
                    </div>
                    {pct >= 1 && <Badge label={t('components.listingCard.discountOff', { percent: pct })} tone="neutral" />}
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
