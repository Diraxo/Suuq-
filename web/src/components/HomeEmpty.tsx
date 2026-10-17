'use client';

import { Compass, PackageOpen } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { Button } from './Button';
import { ListingCard } from './ListingCard';
import { HomeFeed } from '@/lib/homeFeed';
import { Listing } from '@/lib/types';

// Web twin of components/HomeEmpty.tsx on mobile: same wording, same rules —
// the selection stays visible, the explanation names it, and alternatives sit
// in their own labelled section, never mixed into the strict results.
export function HomeEmpty({
  feed,
  categoryName,
  placeName,
  onClearCategory,
  onClearPlace,
  onChoosePlace,
  onBackToSelection,
}: {
  feed: HomeFeed<Listing>;
  categoryName: string | null;
  placeName: string | null;
  onClearCategory: () => void;
  onClearPlace: () => void;
  onChoosePlace: () => void;
  onBackToSelection: () => void;
}) {
  if (feed.needsLocation) {
    return (
      <EmptyState
        icon={Compass}
        title="Where should we look?"
        message="Choose a location, or add your city to your profile, and we'll show the listings closest to it."
        actionLabel="Choose a location"
        onAction={onChoosePlace}
      />
    );
  }

  const message =
    categoryName && placeName
      ? `We don't have any ${categoryName} listings in ${placeName} right now. You're early! Explore other categories to see what's available.`
      : categoryName
        ? `We don't have any ${categoryName} listings right now. You're early! Explore other categories to see what's available.`
        : placeName
          ? `No listings currently match ${placeName} with these filters.`
          : 'No listings match these filters right now.';
  const selection = [categoryName, placeName].filter(Boolean).join(' · ');
  const fb = feed.fallback;
  const fbTitle = !fb
    ? ''
    : fb.kind === 'wider-area'
      ? `Explore nearby areas: more from ${fb.place?.name ?? ''}`
      : fb.kind === 'other-categories'
        ? fb.place
          ? `You may also like in ${fb.place.name}`
          : 'You may also like'
        : 'More from Suuqiye';

  return (
    <div>
      <EmptyState icon={PackageOpen} title="Nothing here just yet." message={message} />
      <div className="-mt-10 flex flex-wrap justify-center gap-2 pb-6">
        {categoryName && (
          <Button variant="outline" size="sm" onClick={onClearCategory}>
            Browse all categories
          </Button>
        )}
        {placeName && (
          <Button variant="outline" size="sm" onClick={onClearPlace}>
            Show all locations
          </Button>
        )}
      </div>
      {fb && fb.items.length > 0 && (
        <section className="mt-6 border-t border-border pt-6" aria-label={fbTitle}>
          <h3 className="text-lg font-semibold text-textPrimary">{fbTitle}</h3>
          {selection && <p className="mb-3 mt-0.5 text-xs text-textSecondary">These don&apos;t match {selection}, so they&apos;re shown separately.</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {fb.items.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
          {selection && (
            <div className="mt-3 flex justify-center">
              <Button variant="ghost" size="sm" onClick={onBackToSelection}>
                Back to {selection}
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
