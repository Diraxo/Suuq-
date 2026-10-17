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
import { ChevronLeft, Eye, Heart, TrendingDown, BarChart3, PencilLine, Tag as TagIcon, CheckCircle2 } from '@/lib/icons';
import { EmptyState } from '@/components/EmptyState';
import { PriceDropModal } from '@/components/PriceDropModal';
import { Listing, ListingStatus } from '@/lib/types';
import { formatBirr } from '@/lib/currency';
import { useAuthStore } from '@/store/auth';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { listMyListings, dropListingPrice, markListingSold } from '@/services/listings';
import { fetchAppealStatusByListing } from '@/lib/supportApi';
import { useModerationStore } from '@/store/moderation';
import { getSellerStats, SellerStats } from '@/services/profile';

// 'removed' is the "Under review" tab: it lists listings staff removed OR deactivated (both are hidden from buyers
// and can be appealed). The tab only appears when the seller actually has such listings.
const TABS: ListingStatus[] = ['available', 'reserved', 'sold', 'expired', 'removed'];
const TAB_LABEL: Record<ListingStatus, string> = {
  available: 'Active',
  reserved: 'Reserved',
  sold: 'Sold',
  expired: 'Expired',
  removed: 'Under review',
  deactivated: 'Under review',
};
const inReview = (s: ListingStatus) => s === 'removed' || s === 'deactivated';

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
  const [markingSoldId, setMarkingSoldId] = useState<string | null>(null);
  const [appeals, setAppeals] = useState<Record<string, { status: string; caseId: string }>>({});
  // A moderation notice arriving in real time (removal, restoration, appeal decision) refreshes this list.
  const noticeCount = useModerationStore((s) => s.notices.length);

  const load = () => {
    if (!session) return;
    setLoading(true);
    Promise.all([listMyListings(session.user.id), getSellerStats(session.user.id)]).then(([rows, sellerStats]) => {
      setListings(rows);
      setStats(sellerStats);
      setLoading(false);
      const review = rows.filter((l) => inReview(l.status)).map((l) => l.id);
      fetchAppealStatusByListing(review).then(setAppeals).catch(() => {});
    });
  };

  useEffect(load, [session, noticeCount]);

  if (!authed) return <div className="min-h-[50vh]" />;

  const filtered = listings.filter((l) => (tab === 'removed' ? inReview(l.status) : l.status === tab));
  const reviewCount = listings.filter((l) => inReview(l.status)).length;
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

  const handleMarkSold = async (listing: Listing) => {
    if (markingSoldId) return;
    if (!window.confirm('Mark this listing as sold? Buyers will see it is no longer available.')) return;
    setMarkingSoldId(listing.id);
    const { error } = await markListingSold(listing.id);
    setMarkingSoldId(null);
    if (error) {
      alert('Could not mark as sold. Check your connection and try again.');
      return;
    }
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
          {TABS.filter((tb) => tb !== 'removed' || reviewCount > 0).map((tb) => (
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
                  <p className="text-base font-bold text-primary">{formatBirr(listing.price, listing.currency)}</p>
                  <div className="mt-1 flex gap-2 text-xs text-textSecondary">
                    <span className="inline-flex items-center gap-1">
                      <Eye size={12} /> {listing.views}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Heart size={12} /> {listing.favoritesCount}
                    </span>
                  </div>
                </Link>
                {inReview(listing.status) && (
                  <div className="flex shrink-0 flex-col items-end gap-1 pr-1 text-xs">
                    <span className="rounded-pill bg-warning/15 px-2 py-0.5 font-medium text-warning">{listing.status === 'removed' ? 'Removed' : 'Deactivated'}</span>
                    {appeals[listing.id] && appeals[listing.id].status !== 'withdrawn' ? (
                      <Link href={`/support/${appeals[listing.id].caseId}`} className="text-primary">
                        Appeal {appeals[listing.id].status}
                      </Link>
                    ) : (
                      <Link href={`/support/new?appeal=listing&listingId=${listing.id}`} className="text-primary">
                        Appeal decision
                      </Link>
                    )}
                  </div>
                )}
                {listing.status === 'available' && (
                  <button
                    onClick={() => setPriceDropTarget(listing)}
                    aria-label="Drop price"
                    className="shrink-0 rounded-full p-2 text-textSecondary hover:bg-background"
                  >
                    <TrendingDown size={18} />
                  </button>
                )}
                {(listing.status === 'available' || listing.status === 'reserved') && (
                  <button
                    onClick={() => handleMarkSold(listing)}
                    disabled={markingSoldId === listing.id}
                    aria-label="Mark as sold"
                    className="shrink-0 rounded-full p-2 text-textSecondary hover:bg-background disabled:opacity-50"
                  >
                    <CheckCircle2 size={18} />
                  </button>
                )}
                {!inReview(listing.status) && (
                  <>
                    <Link href={`/listing/insights/${listing.id}`} aria-label="Listing insights" className="shrink-0 rounded-full p-2 text-textSecondary hover:bg-background">
                      <BarChart3 size={18} />
                    </Link>
                    <Link href={`/listing/edit/${listing.id}`} aria-label="Edit listing" className="shrink-0 rounded-full p-2 text-textSecondary hover:bg-background">
                      <PencilLine size={18} />
                    </Link>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <PriceDropModal
        open={!!priceDropTarget}
        currentPrice={priceDropTarget?.price ?? 0}
        currency={priceDropTarget?.currency}
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
