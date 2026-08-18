'use client';

// Web port of app/my-listings.tsx on mobile: seller stats grid, status
// tabs (Active/Reserved/Sold/Expired), and per-listing price-drop/insights/
// edit actions. `followers`/`rating`/`reviews` come from the same
// getSellerStats() query the Profile page already uses; there is no
// "following" count here because the web app has no follow feature yet
// (store/follow.ts on mobile has no web equivalent — see PHASE3 report).
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft, Eye, Heart, TrendingDown, BarChart3, PencilLine, Tag as TagIcon } from '@/lib/icons';
import { EmptyState } from '@/components/EmptyState';
import { PriceDropModal } from '@/components/PriceDropModal';
import { Listing, ListingStatus } from '@/lib/types';
import { formatBirr } from '@/lib/currency';
import { useAuthStore } from '@/store/auth';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { listMyListings, dropListingPrice } from '@/services/listings';
import { getSellerStats, SellerStats } from '@/services/profile';

const TABS: ListingStatus[] = ['available', 'reserved', 'sold', 'expired'];
const TAB_LABEL: Record<ListingStatus, string> = {
  available: 'Active',
  reserved: 'Reserved',
  sold: 'Sold',
  expired: 'Expired',
  removed: 'Removed',
};

function MyListingsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authed = useRequireAuthPage('/my-listings');
  const session = useAuthStore((s) => s.session);

  const requestedTab = searchParams.get('tab');
  const initialTab: ListingStatus = TABS.includes(requestedTab as ListingStatus) ? (requestedTab as ListingStatus) : 'available';
  const [tab, setTab] = useState<ListingStatus>(initialTab);
  const [listings, setListings] = useState<Listing[]>([]);
  const [stats, setStats] = useState<SellerStats>({ listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 });
  const [loading, setLoading] = useState(true);
  const [priceDropTarget, setPriceDropTarget] = useState<Listing | null>(null);
  const [priceDropLoading, setPriceDropLoading] = useState(false);

  const load = () => {
    if (!session) return;
    setLoading(true);
    Promise.all([listMyListings(session.user.id), getSellerStats(session.user.id)]).then(([rows, sellerStats]) => {
      setListings(rows);
      setStats(sellerStats);
      setLoading(false);
    });
  };

  useEffect(load, [session]);

  if (!authed) return <div className="min-h-[50vh]" />;

  const filtered = listings.filter((l) => l.status === tab);
  const totalViews = listings.reduce((sum, l) => sum + l.views, 0);
  const totalFavorites = listings.reduce((sum, l) => sum + l.favoritesCount, 0);

  const handlePriceDropConfirm = async (newPrice: number) => {
    if (!priceDropTarget) return;
    setPriceDropLoading(true);
    const { error } = await dropListingPrice(priceDropTarget.id, priceDropTarget.price, newPrice);
    setPriceDropLoading(false);
    if (error) {
      alert(error);
      return;
    }
    setPriceDropTarget(null);
    load();
  };

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center gap-2">
          <button onClick={() => router.back()} aria-label="Go back" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface">
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-textPrimary">My Listings</h1>
        </div>

        <div className="mb-4 grid grid-cols-4 gap-y-4 rounded-lg bg-surface p-4 shadow-sm">
          {[
            ['Listings', stats.listingsCount],
            ['Sold', stats.soldCount],
            ['Followers', stats.followers],
            ['Rating', stats.reviewCount > 0 ? stats.rating.toFixed(1) : '0.0'],
            ['Reviews', stats.reviewCount],
            ['Views', totalViews],
            ['Favorites', totalFavorites],
          ].map(([label, value]) => (
            <div key={label as string} className="text-center">
              <p className="text-lg font-bold text-textPrimary">{value}</p>
              <p className="text-xs text-textSecondary">{label}</p>
            </div>
          ))}
        </div>

        <div className="mb-4 flex gap-2">
          {TABS.map((tb) => (
            <button
              key={tb}
              onClick={() => setTab(tb)}
              className={`rounded-pill px-3 py-1.5 text-sm font-medium ${tab === tb ? 'bg-primary text-primaryText' : 'bg-surface text-textSecondary shadow-sm'}`}
            >
              {TAB_LABEL[tb]}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-textSecondary">Loading your listings…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={TagIcon}
            title={`No ${TAB_LABEL[tab].toLowerCase()} listings`}
            message={tab === 'available' ? 'Post an item to see it here.' : 'Nothing in this tab yet.'}
            actionLabel={tab === 'available' ? 'Post an item' : undefined}
            onAction={tab === 'available' ? () => router.push('/sell') : undefined}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((listing) => (
              <div key={listing.id} className="flex items-center gap-3 rounded-lg bg-surface p-2 shadow-sm">
                <Link href={`/listing/${listing.id}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-skeleton">
                  {listing.images[0] && <Image src={listing.images[0]} alt={listing.title} fill sizes="64px" className="object-cover" />}
                </Link>
                <Link href={`/listing/${listing.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-textPrimary">{listing.title}</p>
                  <p className="text-base font-bold text-primary">{formatBirr(listing.price)}</p>
                  <div className="mt-1 flex gap-2 text-xs text-textSecondary">
                    <span className="inline-flex items-center gap-1">
                      <Eye size={12} /> {listing.views}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Heart size={12} /> {listing.favoritesCount}
                    </span>
                  </div>
                </Link>
                {listing.status === 'available' && (
                  <button
                    onClick={() => setPriceDropTarget(listing)}
                    aria-label="Drop price"
                    className="shrink-0 rounded-full p-2 text-textSecondary hover:bg-background"
                  >
                    <TrendingDown size={18} />
                  </button>
                )}
                <Link href={`/listing/insights/${listing.id}`} aria-label="Listing insights" className="shrink-0 rounded-full p-2 text-textSecondary hover:bg-background">
                  <BarChart3 size={18} />
                </Link>
                <Link href={`/listing/edit/${listing.id}`} aria-label="Edit listing" className="shrink-0 rounded-full p-2 text-textSecondary hover:bg-background">
                  <PencilLine size={18} />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      <PriceDropModal
        open={!!priceDropTarget}
        currentPrice={priceDropTarget?.price ?? 0}
        loading={priceDropLoading}
        onCancel={() => setPriceDropTarget(null)}
        onConfirm={handlePriceDropConfirm}
      />
    </div>
  );
}

export default function MyListingsPage() {
  return (
    <Suspense fallback={<div className="min-h-[50vh]" />}>
      <MyListingsInner />
    </Suspense>
  );
}
