import { useState, memo } from 'react';
import { View, FlatList, Pressable, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams, Router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { Card } from '@/components/Card';
import { Stat } from '@/components/Stat';
import { useTheme } from '@/theme/ThemeContext';
import { useMyListingsStore } from '@/store/myListings';
import { useFollowStore } from '@/store/follow';
import { useReviewsStore } from '@/store/reviews';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { imageUrl } from '@/lib/r2';
import { formatBirr } from '@/lib/currency';
import { showSnackbar } from '@/lib/snackbar';
import { Listing, ListingStatus } from '@/types';

const TABS: { key: ListingStatus; label: string }[] = [
  { key: 'available', label: 'Active' },
  { key: 'reserved', label: 'Reserved' },
  { key: 'sold', label: 'Sold' },
  { key: 'expired', label: 'Expired' },
];

type Theme = ReturnType<typeof useTheme>;

type RowProps = {
  item: Listing;
  router: Router;
  dropPrice: (id: string, newPrice: number) => void;
  colors: Theme['colors'];
  spacing: Theme['spacing'];
  radius: Theme['radius'];
};

const MyListingRow = memo(function MyListingRow({ item, router, dropPrice, colors, spacing, radius }: RowProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Image
        source={{ uri: imageUrl(item.images[0], { width: 200 }) }}
        accessibilityLabel={`Photo of ${item.title}`}
        style={{ width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.skeleton }}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={item.id}
        transition={200}
      />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {item.title}
        </Text>
        <Text variant="h3" color="brand">
          {formatBirr(item.price)}
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 2 }}>
          <Badge label={`${item.views} views`} tone="neutral" icon="eye-outline" />
          <Badge label={`${item.favoritesCount} saves`} tone="neutral" icon="heart-outline" />
        </View>
      </View>
      {item.status === 'available' && (
        <Pressable
          onPress={() => dropPrice(item.id, Math.max(1, Math.round(item.price * 0.9)))}
          accessibilityRole="button"
          accessibilityLabel="Drop price by 10%"
          style={{ padding: spacing.xs }}
        >
          <Ionicons name="trending-down-outline" size={20} color={colors.textSecondary} />
        </Pressable>
      )}
      <Pressable onPress={() => router.push(`/listing/insights/${item.id}` as any)} style={{ padding: spacing.xs }}>
        <Ionicons name="stats-chart-outline" size={20} color={colors.textSecondary} />
      </Pressable>
      <Pressable onPress={() => router.push(`/listing/edit/${item.id}` as any)} style={{ padding: spacing.xs }}>
        <Ionicons name="create-outline" size={20} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
});

export default function MyListings() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const params = useLocalSearchParams<{ tab?: string }>();
  const initialTab = TABS.some((t) => t.key === params.tab) ? (params.tab as ListingStatus) : 'available';
  const [tab, setTab] = useState<ListingStatus>(initialTab);
  const [refreshing, setRefreshing] = useState(false);
  const myListings = useMyListingsStore((s) => s.listings);
  const dropPriceStore = useMyListingsStore((s) => s.dropPrice);
  const dropPrice = (id: string, newPrice: number) => {
    dropPriceStore(id, newPrice).then((ok) => {
      if (ok) showSnackbar('Price updated.', { tone: 'success' });
      else showSnackbar('Could not update price. Check your connection and try again.');
    });
  };
  const loadMyListings = useMyListingsStore((s) => s.load);
  const followers = useFollowStore((s) => s.followers);
  const following = useFollowStore((s) => s.following);
  const reviews = useReviewsStore((s) => s.reviews);

  const listings = myListings.filter((l) => l.status === tab);

  // Derived straight from the same reactive stores as the Profile tab (each
  // keeps itself in sync via realtime â€” see store/myListings.ts's
  // `listings` subscription), so every stat updates live with no refresh.
  const stats = {
    listings: myListings.filter((l) => l.status === 'available' || l.status === 'reserved').length,
    followers: followers.length,
    following: following.length,
    sold: myListings.filter((l) => l.status === 'sold').length,
    rating: reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0,
    reviews: reviews.length,
    views: myListings.reduce((sum, l) => sum + l.views, 0),
    favorites: myListings.reduce((sum, l) => sum + l.favoritesCount, 0),
  };

  if (!authed) return <Screen />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          My Listings
        </Text>
      </View>

      <Card style={{ marginBottom: spacing.md }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md }}>
          <View style={{ width: '25%' }}>
            <Stat label="Listings" value={stats.listings} />
          </View>
          <View style={{ width: '25%' }}>
            <Stat label="Sold" value={stats.sold} />
          </View>
          <View style={{ width: '25%' }}>
            <Stat label="Followers" value={stats.followers} />
          </View>
          <View style={{ width: '25%' }}>
            <Stat label="Following" value={stats.following} />
          </View>
          <View style={{ width: '25%' }}>
            <Stat label="Rating" value={stats.rating.toFixed(1)} />
          </View>
          <View style={{ width: '25%' }}>
            <Stat label="Reviews" value={stats.reviews} />
          </View>
          <View style={{ width: '25%' }}>
            <Stat label="Views" value={stats.views} />
          </View>
          <View style={{ width: '25%' }}>
            <Stat label="Favorites" value={stats.favorites} />
          </View>
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md }}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={{
              paddingHorizontal: spacing.sm,
              paddingVertical: 6,
              borderRadius: radius.pill,
              backgroundColor: tab === t.key ? colors.primary : colors.surface,
            }}
          >
            <Text variant="caption" color={tab === t.key ? 'inverse' : 'secondary'}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={listings}
        keyExtractor={(l) => l.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadMyListings().finally(() => setRefreshing(false));
            }}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => (
          <MyListingRow item={item} router={router} dropPrice={dropPrice} colors={colors} spacing={spacing} radius={radius} />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="pricetag-outline"
            title={`No ${tab} listings`}
            message={tab === 'available' ? 'Post your first item to start selling.' : undefined}
            actionLabel={tab === 'available' ? 'Post an item' : undefined}
            onAction={() => router.push('/post')}
          />
        }
      />
    </Screen>
  );
}
