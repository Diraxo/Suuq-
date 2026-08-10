import { useEffect, useMemo } from 'react';
import { View, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EmptyState } from '@/components/EmptyState';
import { ListingCard } from '@/components/ListingCard';
import { useTheme } from '@/theme/ThemeContext';
import { mockListings } from '@/data/mockListings';
import { useListingsStore, resolveListing } from '@/store/listings';
import { findSimilarListings } from '@/data/similarListings';
import { imageUrl } from '@/lib/r2';
import { formatBirr } from '@/lib/currency';
import { Listing } from '@/types';

const ROWS: { key: keyof Listing | 'rating'; label: string }[] = [
  { key: 'price', label: 'Price' },
  { key: 'condition', label: 'Condition' },
  { key: 'city', label: 'Location' },
  { key: 'rating', label: 'Seller rating' },
];

export default function Compare() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const realListings = useListingsStore((s) => s.listings);
  const hasHydrated = useListingsStore((s) => s.hasHydrated);
  const load = useListingsStore((s) => s.load);
  const primary = resolveListing(id, realListings) ?? mockListings[0];

  useEffect(() => {
    if (!hasHydrated) load();
  }, [hasHydrated, load]);

  // Similar listings are always real Supabase rows â€” the mock catalogue is
  // permanent demo inventory, not something a real buyer could actually go
  // compare against or message a seller about.
  const similar = useMemo(() => findSimilarListings(primary, realListings, 10), [realListings, primary]);

  const topMatch = similar[0];
  const items = topMatch ? [primary, topMatch] : [primary];

  if (!hasHydrated) {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
          <BackButton onPress={() => router.back()} />
          <Text variant="h2" style={{ marginLeft: spacing.sm }}>
            Compare
          </Text>
        </View>
      </Screen>
    );
  }

  if (!topMatch) {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
          <BackButton onPress={() => router.back()} />
          <Text variant="h2" style={{ marginLeft: spacing.sm }}>
            Compare
          </Text>
        </View>
        <EmptyState icon="swap-horizontal-outline" title="Nothing to compare yet" message="We couldn't find another listing in this category to compare against." />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Compare
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
          {items.map((it) => (
            <View key={it.id} style={{ flex: 1, alignItems: 'center' }}>
              <Image
                source={{ uri: imageUrl(it.images[0], { width: 400 }) }}
                accessibilityLabel={`Photo of ${it.title}`}
                style={{ width: '100%', height: 100, borderRadius: radius.sm, backgroundColor: colors.skeleton }}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={it.id}
                transition={200}
              />
              <Text variant="bodyMedium" numberOfLines={2} align="center" style={{ marginTop: spacing.xs }}>
                {it.title}
              </Text>
            </View>
          ))}
        </View>

        {ROWS.map((row) => (
          <View key={row.label} style={{ flexDirection: 'row', paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
            {items.map((it) => (
              <View key={it.id + row.label} style={{ flex: 1, alignItems: 'center' }}>
                <Text variant="caption" color="muted">
                  {row.label}
                </Text>
                <Text variant="bodyMedium">
                  {row.key === 'price'
                    ? formatBirr(it.price)
                    : row.key === 'rating'
                    ? `â­ ${it.seller.rating}`
                    : String((it as any)[row.key])}
                </Text>
              </View>
            ))}
          </View>
        ))}

        {similar.length > 1 && (
          <View style={{ marginTop: spacing.lg }}>
            <Text variant="h3" style={{ marginBottom: spacing.sm }}>
              More similar listings
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' }}>
              {similar.slice(1).map((l) => (
                <View key={l.id} style={{ width: '47%' }}>
                  <ListingCard listing={l} />
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
