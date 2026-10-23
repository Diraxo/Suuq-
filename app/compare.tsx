import { useMemo } from 'react';
import { View } from 'react-native';
// react-native-gesture-handler's ScrollView (not core RN's) — the app root
// wraps everything in GestureHandlerRootView (app/_layout.tsx), and a core-RN
// ScrollView there ends up in a different gesture-arbitration system, which
// is what made this screen hard to scroll on Android (same fix already
// applied to app/listing/[id].tsx and app/post/preview.tsx).
import { ScrollView } from 'react-native-gesture-handler';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { idParam } from '@/lib/routeParams';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EmptyState } from '@/components/EmptyState';
import { CompareListingCard } from '@/components/CompareListingCard';
import { SellerRatingInline } from '@/components/SellerRatingInline';
import { useTheme } from '@/theme/ThemeContext';
import { useListing } from '@/hooks/useListings';
import { useResource } from '@/hooks/useResource';
import { fetchComparableListings } from '@/lib/listingsApi';
import { findSimilarListings } from '@/data/similarListings';
import { formatBirr } from '@/lib/currency';
import { Listing } from '@/types';
import { conditionApplies } from '@/data/sellRules';

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
  const { id: rawId } = useLocalSearchParams<{ id?: string }>();
  const id = idParam(rawId);
  // The listing being compared is fetched by id; its candidates are one same-category sample (not the whole catalogue).
  const { listing: primary, status, retry } = useListing(id);
  const candidateKey = primary ? `${primary.id}|${primary.category}|${primary.subcategory ?? ''}` : null;
  const candidates = useResource(candidateKey, () => fetchComparableListings({ category: primary!.category, subcategory: primary!.subcategory, excludeId: primary!.id }));

  const similar = useMemo(() => (primary && candidates.data ? findSimilarListings(primary, candidates.data, 10) : []), [candidates.data, primary]);

  const topMatch = similar[0];

  // Loading is not "nothing to compare": wait for the listing and for its candidates.
  const loading = status === 'loading' || (!!primary && (candidates.status === 'idle' || candidates.status === 'loading') && !candidates.data);
  const failed = status === 'error' || (!!primary && candidates.status === 'error' && !candidates.data);

  if (loading) {
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

  if (failed) {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
          <BackButton onPress={() => router.back()} />
          <Text variant="h2" style={{ marginLeft: spacing.sm }}>
            {t('compare.title')}
          </Text>
        </View>
        <EmptyState icon="cloud-offline-outline" title={t('listing.loadError.title')} message={t('listing.loadError.message')} actionLabel={t('listing.loadError.retry')} onAction={() => (status === 'error' ? retry() : void candidates.reload())} />
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
                      ? formatBirr(it.price, it.currency)
                      : row.key === 'condition'
                      ? conditionApplies(it.category, it.subcategory)
                        ? t(`post.details.condition.${CONDITION_KEY[it.condition]}`)
                        : '—'
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
