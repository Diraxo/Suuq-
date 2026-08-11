import { useCallback, useMemo, useRef, useState } from 'react';
import { View, FlatList, Pressable, ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useScrollToTop } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { ListingCard } from '@/components/ListingCard';
import { Skeleton } from '@/components/Skeleton';
import { ErrorState } from '@/components/ErrorState';
import { UnreadCountBadge } from '@/components/UnreadCountBadge';
import { CategoryIcon } from '@/components/CategoryIcon';
import { NotificationPermissionBanner } from '@/components/NotificationPermissionBanner';
import { useTheme } from '@/theme/ThemeContext';
import { categories, regions } from '@/data/categories';
import { useListingsStore, resolveAllListings, getTrendingScore } from '@/store/listings';
import { useLocationStore } from '@/store/location';
import { useNotifStore } from '@/store/notifications';
import { useAuthStore } from '@/store/auth';
import { useHomeBrowseStore, resetHomeBrowsing, DISCOVERY_TABS } from '@/store/homeBrowse';
import { useResponsiveColumns } from '@/hooks/useResponsiveColumns';
import { useBlockedEitherWayIds, filterBlockedSellers } from '@/lib/blocking';

// Maps each internal DISCOVERY_TABS identifier (also used for switch/case logic
// above) to its i18n key — keeps the identifiers stable while translating only
// the rendered label.
const DISCOVERY_TAB_KEYS: Record<string, string> = {
  'For You': 'forYou',
  Nearby: 'nearby',
  Latest: 'latest',
  Trending: 'trending',
  'Price Drops': 'priceDrops',
};
// The single city filter shown on Home — same shared list (data/categories.ts)
// used by CityPicker/post/location/search, so there is only one place a city
// list is maintained. 'All Locations' maps to useLocationStore's city: null.
const ALL_LOCATIONS = 'All Locations';
const CITY_OPTIONS = [ALL_LOCATIONS, ...regions];

export default function Home() {
  const { colors, spacing, radius } = useTheme();
  const { t } = useTranslation();
  const numColumns = useResponsiveColumns();
  const router = useRouter();
  const activeTab = useHomeBrowseStore((s) => s.activeTab);
  const setActiveTab = useHomeBrowseStore((s) => s.setActiveTab);
  const activeCategory = useHomeBrowseStore((s) => s.activeCategory);
  const setActiveCategory = useHomeBrowseStore((s) => s.setActiveCategory);
  const [refreshing, setRefreshing] = useState(false);
  const allListings = useListingsStore((s) => s.listings);
  const priceDropAt = useListingsStore((s) => s.priceDropAt);
  const loadError = useListingsStore((s) => s.lastError);
  // The global feed is already loaded once at app startup (app/_layout.tsx), so
  // this is real data-readiness, not a fixed artificial delay — a fake timer
  // here was making an already-cached, ready-to-paint list wait regardless.
  const loading = useListingsStore((s) => !s.hasHydrated);
  const blockedIds = useBlockedEitherWayIds();
  const currentCity = useLocationStore((s) => s.city);
  const setCity = useLocationStore((s) => s.setCity);
  const listings = useMemo(() => {
    let base = filterBlockedSellers(resolveAllListings(allListings), blockedIds);
    // City and category filters apply underneath every tab (e.g. "Phones" +
    // "Jigjiga" narrows to phones from Jigjiga, whichever tab is active).
    if (currentCity) base = base.filter((l) => l.city === currentCity);
    if (activeCategory) base = base.filter((l) => l.category === activeCategory);

    switch (activeTab) {
      case 'Latest':
        return [...base].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      case 'Trending':
        return [...base].sort((a, b) => getTrendingScore(b) - getTrendingScore(a));
      case 'Price Drops':
        return base.filter((l) => l.id in priceDropAt).sort((a, b) => (priceDropAt[b.id] ?? 0) - (priceDropAt[a.id] ?? 0));
      default:
        // 'For You' is the default feed; 'Nearby' is the same feed narrowed by
        // the city filter above (no GPS yet, so "nearby" means "selected city").
        return base;
    }
  }, [allListings, blockedIds, currentCity, activeCategory, activeTab, priceDropAt]);
  const unreadNotifs = useNotifStore((s) => s.unreadCount());
  const userId = useAuthStore((s) => s.session?.user.id);
  const listRef = useRef<FlatList>(null);
  useScrollToTop(listRef);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Pull-to-refresh means "give me the latest normal Home feed" — reset the
    // temporary filters (tab/category/city) in addition to refetching, so the
    // user doesn't refresh into the same filtered view they were trying to escape.
    resetHomeBrowsing();
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    useListingsStore.getState().load().finally(() => setRefreshing(false));
  }, []);

  // Only show the full-screen error when there's nothing cached to fall back
  // on — if a refetch fails but we still have a previously loaded feed, keep
  // showing that instead (same "stale but usable" pattern as OfflineBanner).
  if (loadError && listings.length === 0) {
    return (
      <Screen>
        <ErrorState onRetry={() => useListingsStore.getState().load()} />
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
        ref={listRef}
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
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text variant="body" color="secondary">
                  {t('home.greeting')}
                </Text>
                <Text variant="h2" accessibilityRole="header">
                  {t('home.headline')}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push('/notifications')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={unreadNotifs > 0 ? t('home.notificationsUnread', { count: unreadNotifs }) : t('home.notifications')}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 }}
              >
                <View>
                  <Ionicons name="notifications-outline" size={24} color={colors.textPrimary} />
                  <UnreadCountBadge count={unreadNotifs} />
                </View>
              </Pressable>
            </View>

            {userId && <NotificationPermissionBanner userId={userId} />}

            <Pressable
              onPress={() => router.push('/(tabs)/search')}
              style={{ marginTop: spacing.md }}
              accessibilityRole="button"
              accessibilityLabel={t('home.searchAccessibilityLabel')}
            >
              <Input placeholder={t('home.searchPlaceholder')} editable={false} leftIcon={<Ionicons name="search" size={18} color={colors.textMuted} />} />
            </Pressable>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }} contentContainerStyle={{ gap: spacing.xs }}>
              {categories.map((cat) => {
                const isActive = activeCategory === cat.id;
                return (
                  <Pressable
                    key={cat.id}
                    onPress={() => setActiveCategory(isActive ? null : cat.id)}
                    accessibilityRole="button"
                    accessibilityLabel={isActive ? t('home.categorySelected', { name: cat.name }) : cat.name}
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
                        backgroundColor: isActive ? colors.primary : colors.surface,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: 4,
                      }}
                    >
                      <CategoryIcon icon={cat.icon} size={22} color={isActive ? colors.primaryText : colors.primary} />
                    </View>
                    <Text variant="tiny" align="center" numberOfLines={1} color={isActive ? 'brand' : 'primary'}>
                      {cat.name}
                    </Text>
                  </Pressable>
                );
              })}
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
                    {t(`home.tabs.${DISCOVERY_TAB_KEYS[tab]}`)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text variant="h3" accessibilityRole="header" style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
              {t('home.exploreByCity')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
              {CITY_OPTIONS.map((city) => {
                const isAll = city === ALL_LOCATIONS;
                const isActive = isAll ? currentCity === null : currentCity === city;
                return (
                  <Pressable
                    key={city}
                    onPress={() => setCity(isAll ? null : city)}
                    accessibilityRole="button"
                    accessibilityLabel={isAll ? t('home.showListingsAll') : t('home.showListingsCity', { city })}
                    accessibilityState={{ selected: isActive }}
                    style={{
                      paddingHorizontal: spacing.sm,
                      paddingVertical: spacing.xs,
                      borderRadius: radius.md,
                      backgroundColor: isActive ? colors.primary : colors.surface,
                      borderWidth: 1,
                      borderColor: isActive ? colors.primary : colors.border,
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                  >
                    <Ionicons name="location-outline" size={14} color={isActive ? colors.primaryText : colors.primary} />
                    <Text variant="caption" color={isActive ? 'inverse' : 'primary'} style={{ marginLeft: 4 }}>
                      {isAll ? t('home.allLocations') : city}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text variant="h3" accessibilityRole="header" style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
              {t(`home.tabs.${DISCOVERY_TAB_KEYS[activeTab]}`)}
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
      />
    </Screen>
  );
}
