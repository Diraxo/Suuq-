import { useState, memo } from 'react';
import { View, FlatList, Pressable, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams, Router } from 'expo-router';
import { useTranslation } from 'react-i18next';
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
import { PriceDropModal } from '@/components/PriceDropModal';
import { Listing, ListingStatus } from '@/types';

const TABS: { key: ListingStatus }[] = [{ key: 'available' }, { key: 'reserved' }, { key: 'sold' }, { key: 'expired' }];

type Theme = ReturnType<typeof useTheme>;

type RowProps = {
  item: Listing;
  router: Router;
  onRequestPriceDrop: (listing: Listing) => void;
  colors: Theme['colors'];
  spacing: Theme['spacing'];
  radius: Theme['radius'];
};

const MyListingRow = memo(function MyListingRow({ item, router, onRequestPriceDrop, colors, spacing, radius }: RowProps) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Image
        source={{ uri: imageUrl(item.images[0], { width: 200 }) }}
        accessibilityLabel={t('myListings.photoOfA11y', { title: item.title })}
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
          <Badge label={t('myListings.viewsCount', { count: item.views })} tone="neutral" icon="eye-outline" />
          <Badge label={t('myListings.savesCount', { count: item.favoritesCount })} tone="neutral" icon="heart-outline" />
        </View>
      </View>
      {item.status === 'available' && (
        <Pressable
          onPress={() => onRequestPriceDrop(item)}
          accessibilityRole="button"
          accessibilityLabel={t('myListings.dropPriceA11y')}
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
  const { t } = useTranslation();
  const authed = useRequireAuthScreen();
  const params = useLocalSearchParams<{ tab?: string }>();
  const initialTab = TABS.some((tb) => tb.key === params.tab) ? (params.tab as ListingStatus) : 'available';
  const [tab, setTab] = useState<ListingStatus>(initialTab);
  const [refreshing, setRefreshing] = useState(false);
  const myListings = useMyListingsStore((s) => s.listings);
  const dropPriceStore = useMyListingsStore((s) => s.dropPrice);
  const [priceDropTarget, setPriceDropTarget] = useState<Listing | null>(null);
  const [priceDropLoading, setPriceDropLoading] = useState(false);
  const handlePriceDropConfirm = (newPrice: number) => {
    if (!priceDropTarget) return;
    setPriceDropLoading(true);
    dropPriceStore(priceDropTarget.id, newPrice)
      .then((ok) => {
        if (ok) {
          showSnackbar(t('myListings.priceUpdated'), { tone: 'success' });
          setPriceDropTarget(null);
        } else {
          showSnackbar(t('myListings.priceUpdateFailed'));
        }
      })
      .finally(() => setPriceDropLoading(false));
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
          {t('myListings.title')}
        </Text>
      </View>

      <Card style={{ marginBottom: spacing.md }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md }}>
          <View style={{ width: '25%' }}>
            <Stat label={t('myListings.stats.listings')} value={stats.listings} />
          </View>
          <View style={{ width: '25%' }}>
            <Stat label={t('myListings.stats.sold')} value={stats.sold} />
          </View>
          <View style={{ width: '25%' }}>
            <Stat label={t('myListings.stats.followers')} value={stats.followers} />
          </View>
          <View style={{ width: '25%' }}>
            <Stat label={t('myListings.stats.following')} value={stats.following} />
          </View>
          <View style={{ width: '25%' }}>
            <Stat label={t('myListings.stats.rating')} value={stats.rating.toFixed(1)} />
          </View>
          <View style={{ width: '25%' }}>
            <Stat label={t('myListings.stats.reviews')} value={stats.reviews} />
          </View>
          <View style={{ width: '25%' }}>
            <Stat label={t('myListings.stats.views')} value={stats.views} />
          </View>
          <View style={{ width: '25%' }}>
            <Stat label={t('myListings.stats.favorites')} value={stats.favorites} />
          </View>
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md }}>
        {TABS.map((tb) => (
          <Pressable
            key={tb.key}
            onPress={() => setTab(tb.key)}
            style={{
              paddingHorizontal: spacing.sm,
              paddingVertical: 6,
              borderRadius: radius.pill,
              backgroundColor: tab === tb.key ? colors.primary : colors.surface,
            }}
          >
            <Text variant="caption" color={tab === tb.key ? 'inverse' : 'secondary'}>
              {t(`myListings.tabs.${tb.key}`)}
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
          <MyListingRow item={item} router={router} onRequestPriceDrop={setPriceDropTarget} colors={colors} spacing={spacing} radius={radius} />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="pricetag-outline"
            title={t('myListings.emptyTitle', { status: t(`myListings.tabs.${tab}`) })}
            message={tab === 'available' ? t('myListings.emptyMessage') : undefined}
            actionLabel={tab === 'available' ? t('myListings.postAnItem') : undefined}
            onAction={() => router.push('/post')}
          />
        }
      />

      <PriceDropModal
        visible={!!priceDropTarget}
        currentPrice={priceDropTarget?.price ?? 0}
        loading={priceDropLoading}
        onCancel={() => setPriceDropTarget(null)}
        onConfirm={handlePriceDropConfirm}
      />
    </Screen>
  );
}
