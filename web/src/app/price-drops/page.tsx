'use client';

// Web port of app/price-drops.tsx: price reductions on the signed-in seller's own listings.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TrendingDown } from '@/lib/icons';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { useLiveReload } from '@/hooks/useLiveReload';
import { useAuthStore } from '@/store/auth';
import { formatBirr } from '@/lib/currency';
import { Listing } from '@/lib/types';
import { listMyListings, listPriceDrops, PriceDrop } from '@/services/listings';

export default function PriceDropsPage() {
  const authed = useRequireAuthPage('/price-drops');
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const [rows, setRows] = useState<{ listing: Listing; drop: PriceDrop }[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    if (!userId) return;
    listMyListings(userId)
      .then(async (listings) => {
        const drops = await listPriceDrops(listings.map((l) => l.id));
        const byId = new Map(listings.map((l) => [l.id, l]));
        // Newest drop per listing, as on the app.
        const seen = new Set<string>();
        const out: { listing: Listing; drop: PriceDrop }[] = [];
        for (const d of drops) {
          const listing = byId.get(d.listingId);
          if (!listing || seen.has(d.listingId)) continue;
          seen.add(d.listingId);
          out.push({ listing, drop: d });
        }
        setRows(out);
      })
      .finally(() => setLoaded(true));
  }, [userId]);

  useEffect(load, [load]);
  useLiveReload(userId, [{ table: 'listings', filter: `user_id=eq.${userId}` }], load);

  if (!authed) return <div className="min-h-[50vh]" />;

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Price Drops" />
        {!loaded ? (
          <p className="py-10 text-center text-sm text-textSecondary">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={TrendingDown} title="No price drops yet" message="When you lower the price of one of your listings, it shows up here." />
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map(({ listing, drop }) => (
              <Link key={listing.id} href={`/listing/${listing.id}`}>
                <Card className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-textPrimary">{listing.title}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-textMuted line-through">{formatBirr(drop.oldPrice, listing.currency)}</span>
                      <span className="text-base font-bold text-success">{formatBirr(listing.price, listing.currency)}</span>
                    </div>
                  </div>
                  <TrendingDown size={20} className="text-success" />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
