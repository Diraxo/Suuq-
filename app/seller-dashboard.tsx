import { useEffect, useState } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { ListingCard } from '@/components/ListingCard';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { useMyListingsStore } from '@/store/myListings';
import { useFollowStore } from '@/store/follow';
import { useReviewsStore } from '@/store/reviews';
import { getListingViewsSince, getNewFollowersCount, profileToSeller, SellerStats } from '@/lib/sellerStats';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { imageUrl } from '@/lib/r2';

export default function SellerDashboard() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const [range, setRange] = useState<'weekly' | 'monthly'>('weekly');
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);
  const [rangeStats, setRangeStats] = useState({ views: 0, followers: 0 });
  const myListings = useMyListingsStore((s) => s.listings);
  const activeListings = myListings.filter((l) => l.status === 'available' || l.status === 'reserved');
  const soldListings = myListings.filter((l) => l.status === 'sold');

  // Derived from the already-reactive follow/reviews stores (realtime-backed,
  // see store/follow.ts and store/reviews.ts) instead of a one-shot fetch, so
  // the header card updates instantly after a follow, review, or listing sale.
  const followers = useFollowStore((s) => s.followers);
  const reviews = useReviewsStore((s) => s.reviews);
  const sellerStats: SellerStats = {
    listingsCount: activeListings.length,
    soldCount: soldListings.length,
    followers: followers.length,
    rating: reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0,
    reviewCount: reviews.length,
  };

  // Items sold / views / new followers are each queried fresh for the selected
  // window â€” nothing here is a client-side guess against a lifetime total.
  useEffect(() => {
    if (!session) return;
    const since = new Date(Date.now() - (range === 'weekly' ? 7 : 30) * 24 * 60 * 60 * 1000);
    Promise.all([getListingViewsSince(session.user.id, since), getNewFollowersCount(session.user.id, since)]).then(
      ([views, followers]) => setRangeStats({ views, followers })
    );
  }, [session?.user.id, range]);

  if (!authed || !profile) return <Screen />;
  const me = profileToSeller(profile, sellerStats);
  const periodMs = (range === 'weekly' ? 7 : 30) * 24 * 60 * 60 * 1000;
  const soldInRange = soldListings.filter((l) => l.soldAt && Date.now() - l.soldAt <= periodMs);
  const stats = { sold: soldInRange.length, views: rangeStats.views, followers: rangeStats.followers };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Seller Dashboard
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }}>
      <Pressable onPress={() => router.push(`/seller/${me.id}`)}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
          <Image source={{ uri: imageUrl(me.avatar, { width: 160 }) }} accessibilityLabel={`${me.name}'s profile photo`} style={{ width: 48, height: 48, borderRadius: 24 }} cachePolicy="memory-disk" transition={200} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text variant="bodyMedium">{me.name}</Text>
              {me.verified && <Ionicons name="checkmark-circle" size={14} color={colors.primary} />}
            </View>
            <Text variant="caption" color="secondary">
              â­ {me.rating.toFixed(1)} ({me.reviewCount}) Â· {me.followers} followers
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Card>
      </Pressable>

      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md }}>
        {(['weekly', 'monthly'] as const).map((r) => (
          <Pressable
            key={r}
            onPress={() => setRange(r)}
            style={{
              paddingHorizontal: spacing.sm,
              paddingVertical: 6,
              borderRadius: radius.pill,
              backgroundColor: range === r ? colors.primary : colors.surface,
            }}
          >
            <Text variant="caption" color={range === r ? 'inverse' : 'secondary'} style={{ textTransform: 'capitalize' }}>
              {r}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg }}>
        <Card style={{ width: '47%' }}>
          <Text variant="h1" color="brand">
            {stats.sold}
          </Text>
          <Text variant="caption" color="secondary">
            Items sold
          </Text>
        </Card>
        <Card style={{ width: '47%' }}>
          <Text variant="h1">{stats.views}</Text>
          <Text variant="caption" color="secondary">
            Listing views
          </Text>
        </Card>
        <Card style={{ width: '47%' }}>
          <Text variant="h1" color="success">
            {stats.followers}
          </Text>
          <Text variant="caption" color="secondary">
            Followers
          </Text>
        </Card>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
        <Text variant="h3">Active listings</Text>
        <Pressable onPress={() => router.push('/my-listings?tab=available' as any)} hitSlop={8}>
          <Text variant="caption" color="brand">
            See all
          </Text>
        </Pressable>
      </View>
      {activeListings.length === 0 ? (
        <EmptyState icon="pricetag-outline" title="No active listings" actionLabel="Post an item" onAction={() => router.push('/post')} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg }}>
          {activeListings.slice(0, 2).map((l) => (
            <View key={l.id} style={{ width: '47%' }}>
              <ListingCard listing={l} />
            </View>
          ))}
        </View>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
        <Text variant="h3">Sold items</Text>
        <Pressable onPress={() => router.push('/my-listings?tab=sold' as any)} hitSlop={8}>
          <Text variant="caption" color="brand">
            See all
          </Text>
        </Pressable>
      </View>
      {soldListings.length === 0 ? (
        <EmptyState icon="checkmark-done-outline" title="No sold items yet" />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {soldListings.slice(0, 2).map((l) => (
            <View key={l.id} style={{ width: '47%' }}>
              <ListingCard listing={l} />
            </View>
          ))}
        </View>
      )}
      </ScrollView>
    </Screen>
  );
}
