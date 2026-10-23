'use client';

import { Compass, PackageOpen } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { Button } from './Button';
import { ListingCard } from './ListingCard';
import { HomeFeed } from '@/lib/homeFeed';
import { Listing } from '@/lib/types';
import { useT } from '@/lib/i18n';

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
  const t = useT();
  if (feed.needsLocation) {
    return (
      <EmptyState
        icon={Compass}
        title={t('home.nearbyNeedsTitle')}
        message={t('home.nearbyNeedsMessage')}
        actionLabel={t('home.nearbyChoose')}
        onAction={onChoosePlace}
      />
    );
  }

  const message =
    categoryName && placeName
      ? t('home.emptyCategoryPlace', { category: categoryName, place: placeName })
      : categoryName
        ? t('home.emptyCategory', { category: categoryName })
        : placeName
          ? `No listings currently match ${placeName} with these filters.`
          : t('home.emptyGeneric');
  const selection = [categoryName, placeName].filter(Boolean).join(' · ');
  const fb = feed.fallback;
  const fbTitle = !fb
    ? ''
    : fb.kind === 'wider-area'
      ? t('home.fallbackWider', { place: fb.place?.name ?? '' })
      : fb.kind === 'other-categories'
        ? fb.place
          ? t('home.fallbackOtherPlace', { place: fb.place.name })
          : t('home.fallbackOther')
        : t('home.fallbackMarketplace');

  return (
    <div>
      <EmptyState icon={PackageOpen} title={t('home.emptyTitle')} message={message} />
      <div className="-mt-10 flex flex-wrap justify-center gap-2 pb-6">
        {categoryName && (
          <Button variant="outline" size="sm" onClick={onClearCategory}>
            {t('home.browseAllCategories')}
          </Button>
        )}
        {placeName && (
          <Button variant="outline" size="sm" onClick={onClearPlace}>
            {t('home.showAllLocations')}
          </Button>
        )}
      </div>
      {fb && fb.items.length > 0 && (
        <section className="mt-6 border-t border-border pt-6" aria-label={fbTitle}>
          <h3 className="text-lg font-semibold text-textPrimary">{fbTitle}</h3>
          {selection && <p className="mb-3 mt-0.5 text-xs text-textSecondary">{t('home.fallbackNote', { selection })}</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {fb.items.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
          {selection && (
            <div className="mt-3 flex justify-center">
              <Button variant="ghost" size="sm" onClick={onBackToSelection}>
                {t('home.backToSelection', { selection })}
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
