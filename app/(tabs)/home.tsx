import { useCallback, useMemo, useState } from 'react';
import { View, FlatList, Pressable, ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { ListingCard } from '@/components/ListingCard';
import { Skeleton } from '@/components/Skeleton';
import { ErrorState } from '@/components/ErrorState';
import { useTheme } from '@/theme/ThemeContext';
import { categories, featuredCities } from '@/data/categories';
import { useListingsStore, resolveAllListings } from '@/store/listings';
import { useNotifStore } from '@/store/notifications';
import { useResponsiveColumns } from '@/hooks/useResponsiveColumns';
import { useBlockedEitherWayIds, filterBlockedSellers } from '@/lib/blocking';

const DISCOVERY_TABS = ['For You', 'Nearby', 'Latest', 'Trending', 'Price Drops'];

export default function Home() {
  const { colors, spacing, radius } = useTheme();
  const numColumns = useResponsiveColumns();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(DISCOVERY_TABS[0]);
  const [refreshing, setRefreshing] = useState(false);
  const [hasError, setHasError] = useState(false);
  const allListings = useListingsStore((s) => s.listings);
  // The global feed is already loaded once at app startup (app/_layout.tsx), so
  // this is real data-readiness, not a fixed artificial delay — a fake timer
  // here was making an already-cached, ready-to-paint list wait regardless.
  const loading = useListingsStore((s) => !s.hasHydrated);
  const blockedIds = useBlockedEitherWayIds();
  const listings = useMemo(() => filterBlockedSellers(resolveAllListings(allListings), blockedIds), [allListings, blockedIds]);
  const unreadNotifs = useNotifStore((s) => s.unreadCount());

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    useListingsStore.getState().load().finally(() => setRefreshing(false));
  }, []);

  if (hasError) {
    return (
      <Screen>
        <ErrorState onRetry={() => setHasError(false)} />
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen noPadding>
        <View style={{ padding: spacing.md, gap: spacing.sm }}>
          <Skeleton width={160} height={14} />
          <Skeleton width={240} height={22} />
          <Skeleton height={50} radius={radius.sm} />
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            {Array.from({ length: 2 }).map((_, i) => (
              <View key={i} style={{ flex: 1, gap: spacing.xs }}>
                <Skeleton height={140} radius={radius.md} />
                <Skeleton height={14} />
                <Skeleton width="60%" height={14} />
              </View>
            ))}
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']} noPadding>
      <FlatList
        key={numColumns}
        data={listings}
        keyExtractor={(item) => item.id}
        numColumns={numColumns}
        columnWrapperStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <View style={{ flex: 1 }}>
            <ListingCard listing={item} />
          </View>
        )}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
              <View>
                <Text variant="body" color="secondary">
                  Good morning 👋
                </Text>
                <Text variant="h2" accessibilityRole="header">
                  What are you looking for today?
                </Text>
              </View>
              <Pressable
                onPress={() => router.push('/notifications')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={unreadNotifs > 0 ? `Notifications, ${unreadNotifs} unread` : 'Notifications'}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 }}
              >
                <Ionicons name="notifications-outline" size={24} color={colors.textPrimary} />
                {unreadNotifs > 0 && (
                  <View
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      width: 9,
                      height: 9,
                      borderRadius: 5,
                      backgroundColor: colors.accent,
                      borderWidth: 1.5,
                      borderColor: colors.background,
                    }}
                  />
                )}
              </Pressable>
            </View>

            <Pressable
              onPress={() => router.push('/(tabs)/search')}
              style={{ marginTop: spacing.md }}
              accessibilityRole="button"
              accessibilityLabel="Search phones, cars, furniture, and more"
            >
              <Input placeholder="Search phones, cars, furniture..." editable={false} leftIcon={<Ionicons name="search" size={18} color={colors.textMuted} />} />
            </Pressable>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }} contentContainerStyle={{ gap: spacing.xs }}>
              {categories.slice(0, 8).map((cat) => (
                <Pressable
                  key={cat.id}
                  onPress={() => router.push(`/category/${cat.id}` as any)}
                  style={{
                    alignItems: 'center',
                    width: 68,
                  }}
                >
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: radius.lg,
                      backgroundColor: colors.surface,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 4,
                    }}
                  >
                    <Ionicons name={cat.icon as any} size={22} color={colors.primary} />
                  </View>
                  <Text variant="tiny" align="center" numberOfLines={1}>
                    {cat.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.lg }} contentContainerStyle={{ gap: spacing.xs }}>
              {DISCOVERY_TABS.map((tab) => (
                <Pressable
                  key={tab}
                  onPress={() => setActiveTab(tab)}
                  style={{
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 6,
                    borderRadius: radius.pill,
                    backgroundColor: activeTab === tab ? colors.primary : colors.surface,
                  }}
                >
                  <Text variant="caption" color={activeTab === tab ? 'inverse' : 'secondary'}>
                    {tab}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text variant="h3" accessibilityRole="header" style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
              Explore by city
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
              {featuredCities.map((city) => (
                <Pressable
                  key={city}
                  onPress={() => router.push(`/city/${city}` as any)}
                  accessibilityRole="button"
                  accessibilityLabel={`Browse listings in ${city}`}
                  style={{
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs,
                    borderRadius: radius.md,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    flexDirection: 'row',
                    alignItems: 'center',
                  }}
                >
                  <Ionicons name="location-outline" size={14} color={colors.primary} />
                  <Text variant="caption" style={{ marginLeft: 4 }}>
                    {city}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text variant="h3" accessibilityRole="header" style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
              {activeTab}
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
      />
    </Screen>
  );
}
