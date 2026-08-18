import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
// react-native-gesture-handler's ScrollView (not core RN's) — the app root
// wraps everything in GestureHandlerRootView (app/_layout.tsx), and a core-RN
// ScrollView there ends up in a different gesture-arbitration system, which
// is what made this screen hard to scroll on Android (same fix already
// applied to app/listing/[id].tsx and app/post/preview.tsx).
import { ScrollView } from 'react-native-gesture-handler';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EmptyState } from '@/components/EmptyState';
import { CompareListingCard } from '@/components/CompareListingCard';
import { SellerRatingInline } from '@/components/SellerRatingInline';
import { useTheme } from '@/theme/ThemeContext';
import { useListingsStore, resolveListing } from '@/store/listings';
import { findSimilarListings } from '@/data/similarListings';
import { formatBirr } from '@/lib/currency';
import { Listing } from '@/types';

const ROWS: { key: keyof Listing | 'rating'; labelKey: string }[] = [
  { key: 'price', labelKey: 'compare.rows.price' },
  { key: 'condition', labelKey: 'compare.rows.condition' },
  { key: 'city', labelKey: 'compare.rows.location' },
  { key: 'rating', labelKey: 'compare.rows.sellerRating' },
];

const CONDITION_KEY: Record<string, string> = { new: 'new', 'like-new': 'likeNew', used: 'used', 'for-parts': 'needsRepair' };

export default function Compare() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const realListings = useListingsStore((s) => s.listings);
  const hasHydrated = useListingsStore((s) => s.hasHydrated);
  const load = useListingsStore((s) => s.load);
  const primary = resolveListing(id, realListings);

  useEffect(() => {
    if (!hasHydrated) load();
  }, [hasHydrated, load]);

  const similar = useMemo(() => (primary ? findSimilarListings(primary, realListings, 10) : []), [realListings, primary]);

  const topMatch = similar[0];

  if (!hasHydrated) {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
          <BackButton onPress={() => router.back()} />
          <Text variant="h2" style={{ marginLeft: spacing.sm }}>
            {t('compare.title')}
          </Text>
        </View>
      </Screen>
    );
  }

  if (!primary || !topMatch) {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
          <BackButton onPress={() => router.back()} />
          <Text variant="h2" style={{ marginLeft: spacing.sm }}>
            {t('compare.title')}
          </Text>
        </View>
        <EmptyState icon="swap-horizontal-outline" title={t('compare.emptyTitle')} message={t('compare.emptyMessage')} />
      </Screen>
    );
  }

  const items = [primary, topMatch];

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('compare.title')}
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.xl }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, alignItems: 'flex-start' }}>
          {items.map((it, index) => (
            <View key={it.id} style={{ flex: 1 }}>
              <Text variant="caption" color="muted" style={{ marginBottom: spacing.xxs }}>
                {index === 0 ? t('compare.yourListing') : t('compare.topMatch')}
              </Text>
              <CompareListingCard listing={it} />
            </View>
          ))}
        </View>

        {ROWS.map((row) => (
          <View key={row.labelKey} style={{ flexDirection: 'row', paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
            {items.map((it) => (
              <View key={it.id + row.labelKey} style={{ flex: 1, alignItems: 'center' }}>
                <Text variant="caption" color="muted" style={{ marginBottom: 2 }}>
                  {t(row.labelKey)}
                </Text>
                {row.key === 'rating' ? (
                  <SellerRatingInline seller={it.seller} />
                ) : (
                  <Text variant="bodyMedium">
                    {row.key === 'price'
                      ? formatBirr(it.price)
                      : row.key === 'condition'
                      ? t(`post.details.condition.${CONDITION_KEY[it.condition]}`)
                      : String((it as any)[row.key])}
                  </Text>
                )}
              </View>
            ))}
          </View>
        ))}

        {similar.length > 1 && (
          <View style={{ marginTop: spacing.lg }}>
            <Text variant="h3" style={{ marginBottom: spacing.sm }}>
              {t('compare.moreSimilarListings')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' }}>
              {similar.slice(1).map((l) => (
                <View key={l.id} style={{ width: '47%' }}>
                  <CompareListingCard listing={l} />
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
