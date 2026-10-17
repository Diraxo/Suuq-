import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ListingCard } from '@/components/ListingCard';
import { useTheme } from '@/theme/ThemeContext';
import { HomeFeed } from '@/lib/homeFeed';
import { Listing } from '@/types';

type Props = {
  feed: HomeFeed<Listing>;
  numColumns: number;
  categoryName: string | null;
  placeName: string | null;
  onClearCategory: () => void;
  onClearPlace: () => void;
  onChoosePlace: () => void;
  onBackToSelection: () => void;
};

// Shown when nothing strictly matches the chosen tab/category/location. The
// selection stays visible above it (nothing is reset), the explanation names
// it, and any alternatives sit in their own labelled section underneath — they
// are never mixed into a list that claims to match the selection.
export function HomeEmpty({ feed, numColumns, categoryName, placeName, onClearCategory, onClearPlace, onChoosePlace, onBackToSelection }: Props) {
  const { t } = useTranslation();
  const { spacing } = useTheme();

  if (feed.needsLocation) {
    return <EmptyState icon="navigate-outline" title={t('home.nearbyNeedsTitle')} message={t('home.nearbyNeedsMessage')} actionLabel={t('home.nearbyChoose')} onAction={onChoosePlace} />;
  }

  const message =
    categoryName && placeName
      ? t('home.emptyCategoryPlace', { category: categoryName, place: placeName })
      : categoryName
        ? t('home.emptyCategory', { category: categoryName })
        : placeName
          ? t('home.emptyPlace', { place: placeName })
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
    <View>
      <EmptyState icon={categoryName ? 'pricetags-outline' : 'storefront-outline'} title={t('home.emptyTitle')} message={message} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.xs, marginTop: -spacing.md, paddingHorizontal: spacing.md }}>
        {categoryName && <Button label={t('home.browseAllCategories')} variant="outline" size="sm" onPress={onClearCategory} />}
        {placeName && <Button label={t('home.showAllLocations')} variant="outline" size="sm" onPress={onClearPlace} />}
      </View>
      {fb && fb.items.length > 0 && (
        <View style={{ marginTop: spacing.xl, paddingHorizontal: spacing.md }}>
          <Text variant="h3" accessibilityRole="header">
            {fbTitle}
          </Text>
          {selection ? (
            <Text variant="caption" color="secondary" style={{ marginTop: 2, marginBottom: spacing.sm }}>
              {t('home.fallbackNote', { selection })}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs / 2 }}>
            {fb.items.map((l) => (
              <View key={l.id} style={{ width: `${100 / numColumns}%`, paddingHorizontal: spacing.xs / 2 }}>
                <ListingCard listing={l} />
              </View>
            ))}
          </View>
          {selection ? <Button label={t('home.backToSelection', { selection })} variant="ghost" size="sm" onPress={onBackToSelection} /> : null}
        </View>
      )}
    </View>
  );
}
