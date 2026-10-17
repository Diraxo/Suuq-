'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Heart, MapPin } from '@/lib/icons';
import { Badge } from './Badge';
import { Listing } from '@/lib/types';
import { useFavoritesStore } from '@/store/favorites';
import { registerKnownListingIds, useVisibilityStore } from '@/store/visibility';
import { requireAuth } from '@/store/authPrompt';
import { formatBirr } from '@/lib/currency';
import { useAuthStore } from '@/store/auth';

// Mirrors components/ListingCard.tsx on mobile: 4/5 image, rounded-md
// surface card with shadow, status badge top-left, favorite heart top-right.
export function ListingCard({ listing }: { listing: Listing }) {
  const favorited = useFavoritesStore((s) => s.isFavorited(listing.id));
  const toggle = useFavoritesStore((s) => s.toggle);
  // Nobody favorites their own listing, so the heart is not shown on it.
  const isOwn = useAuthStore((s) => s.session?.user.id === listing.seller.id);
  // Staff removed/deactivated this listing while it was on screen: drop it immediately (real-time + reconciled).
  const hiddenByServer = useVisibilityStore((s) => s.hidden.has(listing.id));
  useEffect(() => {
    registerKnownListingIds([listing.id]);
  }, [listing.id]);
  if (hiddenByServer) return null;

  const statusBadge =
    listing.status === 'reserved' ? (
      <Badge label="Reserved" tone="warning" />
    ) : listing.status === 'sold' ? (
      <Badge label="Sold" tone="solid" />
    ) : listing.status === 'expired' ? (
      <Badge label="Expired" tone="neutral" />
    ) : listing.status === 'removed' ? (
      <Badge label="Removed" tone="warning" />
    ) : listing.priceReduced ? (
      <Badge label="Price reduced" tone="success" />
    ) : listing.boosted ? (
      <Badge label="Boosted" tone="accent" />
    ) : null;

  return (
    <Link href={`/listing/${listing.id}`} className="group mb-4 block overflow-hidden rounded-md bg-surface shadow-sm transition-transform hover:-translate-y-0.5">
      <div className="relative aspect-[4/5] w-full bg-skeleton">
        <Image
          src={listing.images[0]}
          alt={listing.title}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          className="object-cover"
        />
        {statusBadge && <div className="absolute left-2 top-2">{statusBadge}</div>}
        {!isOwn && (
          <button
            onClick={(e) => {
              e.preventDefault();
              requireAuth(() => toggle(listing.id), { pendingFavoriteId: listing.id });
            }}
            aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/45"
          >
            <Heart size={15} className={favorited ? 'fill-accent text-accent' : 'text-white'} />
          </button>
        )}
      </div>
      <div className="p-3">
        <p className="truncate text-[15px] font-medium text-textPrimary">{listing.title}</p>
        <p className="mt-0.5 text-lg font-bold text-primary">{formatBirr(listing.price, listing.currency)}</p>
        <div className="mt-1 flex items-center gap-0.5 text-textMuted">
          <MapPin size={12} />
          <span className="text-xs">
            {listing.city} · {listing.postedLabel}
          </span>
        </div>
      </div>
    </Link>
  );
}
