import { useMemo } from 'react';
import { View, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ListingCard } from '@/components/ListingCard';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useRecentlyViewedStore } from '@/store/recentlyViewed';
import { useListingsStore, resolveListing } from '@/store/listings';

export default function RecentlyViewed() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const viewedIds = useRecentlyViewedStore((s) => s.viewedIds);
  const allListings = useListingsStore((s) => s.listings);
  const viewed = useMemo(
    () => viewedIds.map((id) => resolveListing(id, allListings)).filter((l): l is NonNullable<typeof l> => !!l),
    [viewedIds, allListings]
  );

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Recently Viewed
        </Text>
      </View>

      <FlatList
        data={viewed}
        keyExtractor={(l) => l.id}
        numColumns={2}
        showsVerticalScrollIndicator={false}
        columnWrapperStyle={{ gap: spacing.sm }}
        renderItem={({ item }) => (
          <View style={{ flex: 1 }}>
            <ListingCard listing={item} />
          </View>
        )}
        ListEmptyComponent={<EmptyState icon="time-outline" title="Nothing viewed yet" message="Listings you open will show up here so you can find them again." />}
      />
    </Screen>
  );
}
