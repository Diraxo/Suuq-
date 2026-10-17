'use client';

// Web port of app/seller-dashboard.tsx: lifetime header, Weekly/Monthly toggle for items sold / views / new
// followers, and the seller's active and sold items. Everything reloads live (see useLiveReload), and views never
// include the seller's own visits to their listings.
import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronRight, ShieldCheck, Tag as TagIcon, CheckCircle2 } from '@/lib/icons';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ListingCard } from '@/components/ListingCard';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { useLiveReload } from '@/hooks/useLiveReload';
import { useAuthStore, useCurrentUser } from '@/store/auth';
import { Listing } from '@/lib/types';
import { listMyListings } from '@/services/listings';
import { getSellerStats, getListingViewsSince, getNewFollowersCount, getItemsSoldSince, SellerStats } from '@/services/profile';

const EMPTY: SellerStats = { listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 };

export default function SellerDashboardPage() {
  const authed = useRequireAuthPage('/seller-dashboard');
  const session = useAuthStore((s) => s.session);
  const user = useCurrentUser();
  const userId = session?.user.id ?? null;
  const [range, setRange] = useState<'weekly' | 'monthly'>('weekly');
  const [listings, setListings] = useState<Listing[]>([]);
  const [stats, setStats] = useState<SellerStats>(EMPTY);
  const [rangeStats, setRangeStats] = useState({ views: 0, followers: 0, sold: 0 });
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    if (!userId) return;
    const since = new Date(Date.now() - (range === 'weekly' ? 7 : 30) * 24 * 60 * 60 * 1000);
    Promise.all([listMyListings(userId), getSellerStats(userId), getListingViewsSince(userId, since), getNewFollowersCount(userId, since), getItemsSoldSince(userId, since)])
      .then(([rows, sellerStats, views, followers, soldCount]) => {
        setListings(rows);
        setStats(sellerStats);
        setRangeStats({ views, followers, sold: soldCount });
      })
      .finally(() => setLoaded(true));
  }, [userId, range]);

  useEffect(load, [load]);
  useLiveReload(userId, [
    { table: 'listings', filter: `user_id=eq.${userId}` },
    { table: 'followers', filter: `following_id=eq.${userId}` },
    { table: 'listing_view_events', filter: `seller_id=eq.${userId}` },
    { table: 'reviews', filter: `seller_id=eq.${userId}` },
  ], load);

  if (!authed || !user) return <div className="min-h-[50vh]" />;

  const active = listings.filter((l) => l.status === 'available' || l.status === 'reserved');
  const sold = listings.filter((l) => l.status === 'sold');

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Seller Dashboard" />

        <Link href={`/seller/${user.id}`}>
          <Card className="mb-4 flex items-center gap-3">
            <Image src={user.avatar} alt={user.name} width={48} height={48} className="h-12 w-12 rounded-full object-cover" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 text-sm font-medium text-textPrimary">
                {user.name}
                {user.verified && <ShieldCheck size={14} className="text-primary" aria-label="Verified" />}
              </p>
              <p className="text-xs text-textSecondary">
                {stats.rating.toFixed(1)} ★ ({stats.reviewCount} reviews) · {stats.followers} followers
              </p>
            </div>
            <ChevronRight size={18} className="text-textMuted" />
          </Card>
        </Link>

        <div className="mb-4 flex gap-2">
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

        <div className="mb-6 grid grid-cols-2 gap-3">
          <Card>
            <p className="text-2xl font-bold text-primary">{loaded ? rangeStats.sold : '–'}</p>
            <p className="text-xs text-textSecondary">Items sold</p>
          </Card>
          <Card>
            <p className="text-2xl font-bold text-textPrimary">{loaded ? rangeStats.views : '–'}</p>
            <p className="text-xs text-textSecondary">Listing views</p>
          </Card>
          <Card>
            <p className="text-2xl font-bold text-success">{loaded ? rangeStats.followers : '–'}</p>
            <p className="text-xs text-textSecondary">New followers</p>
          </Card>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-textPrimary">Active listings ({stats.listingsCount})</h2>
          <Link href="/my-listings?tab=available" className="text-sm text-primary">
            See all
          </Link>
        </div>
        {active.length === 0 ? (
          <EmptyState icon={TagIcon} title="No active listings" message="Post an item to see it here." />
        ) : (
          <div className="mb-6 grid grid-cols-2 gap-3">
            {active.slice(0, 2).map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-textPrimary">Sold items ({stats.soldCount})</h2>
          <Link href="/my-listings?tab=sold" className="text-sm text-primary">
            See all
          </Link>
        </div>
        {sold.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="No sold items yet" message="Items you mark as sold appear here." />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {sold.slice(0, 2).map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
