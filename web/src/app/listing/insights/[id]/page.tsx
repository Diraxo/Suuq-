'use client';

// Web port of app/listing/insights/[id].tsx on mobile: views, favorites and
// price-drop-count metrics for a single listing, plus a created/updated
// timeline. Owner-only, same as mobile (useRequireAuthScreen there).
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Eye, Heart, TrendingDown, Tag as TagIcon } from '@/lib/icons';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Listing } from '@/lib/types';
import { getListing, listPriceDrops } from '@/services/listings';
import { useAuthStore } from '@/store/auth';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';

export default function ListingInsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const authed = useRequireAuthPage(`/listing/insights/${id}`);
  const uid = useAuthStore((s) => s.session?.user.id);
  const [listing, setListing] = useState<Listing | null | undefined>(undefined);
  const [priceDropCount, setPriceDropCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getListing(id).then((l) => {
      if (cancelled) return;
      setListing(l ?? null);
    });
    listPriceDrops([id]).then((drops) => {
      if (!cancelled) setPriceDropCount(drops.length);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!authed) return <div className="min-h-[50vh]" />;

  const backButton = (
    <div className="mb-4 flex items-center gap-2">
      <button onClick={() => router.back()} aria-label="Go back" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface">
        <ChevronLeft size={20} />
      </button>
      <h1 className="text-xl font-bold text-textPrimary">Listing insights</h1>
    </div>
  );

  if (listing === undefined) {
    return (
      <div className="px-4 pt-4 md:px-6 md:pt-8">
        <div className="mx-auto max-w-2xl">{backButton}</div>
      </div>
    );
  }

  if (listing === null || listing.seller.id !== uid) {
    return (
      <div className="px-4 pt-4 md:px-6 md:pt-8">
        <div className="mx-auto max-w-2xl">
          {backButton}
          <EmptyState icon={TagIcon} title="Listing not found" message="It may have been removed." actionLabel="Go back" onAction={() => router.back()} />
        </div>
      </div>
    );
  }

  const metrics = [
    { icon: Eye, label: 'Views', value: listing.views },
    { icon: Heart, label: 'Favorites', value: listing.favoritesCount },
    { icon: TrendingDown, label: 'Price drops', value: priceDropCount },
  ];

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        {backButton}
        <p className="mb-4 truncate text-sm font-medium text-textPrimary">{listing.title}</p>

        <div className="flex flex-wrap gap-3">
          {metrics.map((m) => (
            <Card key={m.label} elevated className="w-[47%] flex-1">
              <m.icon size={18} className="text-primary" />
              <p className="mt-2 text-2xl font-bold text-textPrimary">{m.value}</p>
              <p className="text-xs text-textSecondary">{m.label}</p>
            </Card>
          ))}
        </div>

        <Card elevated={false} className="mt-4">
          <p className="mb-2 text-sm font-medium text-textPrimary">Timeline</p>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <span className="text-textSecondary">Created</span>
              <span className="text-textPrimary">{listing.createdAt ? new Date(listing.createdAt).toLocaleDateString() : '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-textSecondary">Last updated</span>
              <span className="text-textPrimary">{listing.updatedAt ? new Date(listing.updatedAt).toLocaleDateString() : '—'}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
