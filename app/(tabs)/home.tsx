import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { View, FlatList, Pressable, ScrollView, RefreshControl, Modal, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
// import { useScrollToTop } from '@react-navigation/native';
import { useScrollToTop } from 'expo-router/react-navigation';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { AccountRestrictionBanner } from '@/components/AccountRestrictionBanner';
import { ListingCard } from '@/components/ListingCard';
import { FeedFooter, FeedSkeleton } from '@/components/FeedParts';
import { ErrorState } from '@/components/ErrorState';
import { UnreadCountBadge } from '@/components/UnreadCountBadge';
import { CategoryIcon } from '@/components/CategoryIcon';
import { NotificationPermissionBanner } from '@/components/NotificationPermissionBanner';
import { useTheme } from '@/theme/ThemeContext';
import { categories } from '@/data/categories';
import { useLocationsStore } from '@/store/locations';
import { LocationList } from '@/components/LocationList';
import { KeyboardSheet } from '@/components/KeyboardSheet';
import { LocNode, ancestors, displayName, findByName, toLang } from '@/lib/locationTree';
import { FallbackKind, FeedCategory, scopeBack, scopeScrollTarget, scopeSelector } from '@/lib/homeFeed';
import { buildHomeQuery, categoryValues, fallbackPlan, feedKey, runFallback } from '@/lib/homeFeedPaging';
import { fetchCurrencyOptions, fetchFeedSample } from '@/lib/homeFeedApi';
import { homeFeed } from '@/store/homeFeed';
import { usePagedFeed } from '@/hooks/usePagedFeed';
import { usePriceOptions } from '@/hooks/usePriceOptions';
import { useVisibilityStore, withoutHidden } from '@/store/visibility';
import { homeRefresh } from '@/store/homeRefresh';
import { HomeEmpty } from '@/components/HomeEmpty';
import { currencyLabel } from '@/lib/currency';
import { useLocationStore } from '@/store/location';
import { useNotifStore } from '@/store/notifications';
import { useAuthStore } from '@/store/auth';
import { useHomeBrowseStore, DISCOVERY_TABS } from '@/store/homeBrowse';
import { useResponsiveColumns } from '@/hooks/useResponsiveColumns';
import { useBlockedEitherWayIds, filterBlockedSellers } from '@/lib/blocking';
import { Listing } from '@/types';

// Maps each internal DISCOVERY_TABS identifier (also used for switch/case logic
// above) to its i18n key — keeps the identifiers stable while translating only
// the rendered label.
const DISCOVERY_TAB_KEYS: Record<string, string> = {
  'For You': 'forYou',
  Nearby: 'nearby',
  Latest: 'latest',
  Trending: 'trending',
  Price: 'price',
  'Price Drops': 'priceDrops',
};
// The location filter shown on Home — the same admin-managed directory
// (store/locations.ts) used by CityPicker/post/location, so there is only one
// place places are maintained. It drills country → region → city; "All
// Locations" maps to useLocationStore's scopeId: null.

export default function Home() {
  const { colors, spacing, radius } = useTheme();
  const { t, i18n } = useTranslation();
  const numColumns = useResponsiveColumns();
  const router = useRouter();
  const activeTab = useHomeBrowseStore((s) => s.activeTab);
  const setActiveTab = useHomeBrowseStore((s) => s.setActiveTab);
  const activeCategory = useHomeBrowseStore((s) => s.activeCategory);
  const setActiveCategory = useHomeBrowseStore((s) => s.setActiveCategory);
  const priceOrder = useHomeBrowseStore((s) => s.priceOrder);
  const setPriceOrder = useHomeBrowseStore((s) => s.setPriceOrder);
  const priceCurrency = useHomeBrowseStore((s) => s.priceCurrency);
  const setPriceCurrency = useHomeBrowseStore((s) => s.setPriceCurrency);
  const [priceMenuOpen, setPriceMenuOpen] = useState(false);
  const refresh = useSyncExternalStore(homeRefresh.subscribe, homeRefresh.getState, homeRefresh.getState);
  const blockedIds = useBlockedEitherWayIds();
  const hidden = useVisibilityStore((s) => s.hidden);
  const locIndex = useLocationsStore((s) => s.index);
  const locStatus = useLocationsStore((s) => s.status);
  const loadLocations = useLocationsStore((s) => s.load);
  useEffect(() => {
    loadLocations();
  }, [loadLocations]);
  const scopeId = useLocationStore((s) => s.scopeId);
  const setScope = useLocationStore((s) => s.setScope);
  const lang = toLang(i18n.language);
  const [pickerOpen, setPickerOpen] = useState(false);
  const scopeNode = scopeId ? locIndex.byId.get(scopeId) : undefined;
  const selector = useMemo(() => scopeSelector(locIndex, scopeId, lang), [locIndex, scopeId, lang]);
  const scopeTarget = scopeScrollTarget(selector);
  const crumbs = scopeNode ? [...ancestors(locIndex, scopeNode.id), scopeNode] : [];
  const back = scopeBack(locIndex, scopeId);
  const profileCity = useAuthStore((s) => s.profile?.city);
  const homePlaceId = useMemo(() => findByName(locIndex, profileCity)?.id ?? null, [locIndex, profileCity]);
  const category = useMemo(() => categories.find((c) => c.id === activeCategory) ?? null, [activeCategory]);
  const feedCategory: FeedCategory | null = useMemo(() => (category ? { id: category.id, name: category.name } : null), [category]);

  // Which listings to show is decided on the server, one page at a time (home_feed, migration 0042) — the app
  // never downloads the whole catalogue. buildHomeQuery turns the selections into that request using the same
  // rules lib/homeFeed.ts defines (the website runs the identical code).
  // Wait for the place directory before asking when the answer depends on it (a saved place, or Nearby), so a
  // first load is not for the wrong place.
  const awaitingDirectory = (!!scopeId || activeTab === 'Nearby') && locIndex.nodes.length === 0 && (locStatus === 'idle' || locStatus === 'loading');
  const priceOptions = usePriceOptions(activeTab === 'Price' && !awaitingDirectory, categoryValues(feedCategory), scopeNode ? scopeNode.id : null, fetchCurrencyOptions, refresh.lastUpdatedAt ?? 0);
  const hq = useMemo(
    () =>
      buildHomeQuery({
        index: locIndex,
        scopeId,
        category: feedCategory,
        tab: activeTab,
        priceOrder,
        currency: priceCurrency,
        homePlaceId,
        priceOptions: priceOptions.options,
      }),
    [locIndex, scopeId, feedCategory, activeTab, priceOrder, priceCurrency, homePlaceId, priceOptions.options]
  );
  const wantedQuery = awaitingDirectory ? null : hq.query;
  const wantedKey = wantedQuery ? feedKey(wantedQuery) : null;
  useEffect(() => {
    homeFeed.setQuery(wantedQuery);
    // `wantedQuery` is fully determined by `wantedKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);
  const feedState = usePagedFeed(homeFeed);
  // Hidden by staff since this screen loaded, or from a blocked seller: gone at once, without a refetch.
  const items = useMemo(() => withoutHidden(filterBlockedSellers(feedState.items, blockedIds), hidden), [feedState.items, blockedIds, hidden]);
  const emptyKey = feedState.status === 'ready' && items.length === 0 ? `${feedState.key}|${activeCategory}|${scopeId}` : null;
  const [fallback, setFallback] = useState<{ key: string; kind: FallbackKind; place: LocNode | null; items: Listing[] } | null>(null);
  // Nothing matched: look for clearly labelled alternatives (a wider place, other categories, the marketplace).
  useEffect(() => {
    if (!emptyKey || hq.needsLocation) return;
    let live = true;
    runFallback(fallbackPlan(locIndex, scopeId, feedCategory), fetchFeedSample, () => live)
      .then((found) => {
        if (!live) return;
        const visible = found ? filterBlockedSellers(found.items, blockedIds) : [];
        setFallback(found && visible.length ? { key: emptyKey, kind: found.kind, place: found.place, items: visible } : null);
      })
      .catch(() => live && setFallback(null)); // alternatives are optional; the empty state works without them
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the empty selection changes
  }, [emptyKey]);
  const emptyFeed = useMemo(
    () => ({
      items: [] as Listing[],
      needsLocation: hq.needsLocation,
      nearbyAnchor: hq.nearbyAnchor,
      price: hq.price,
      fallback: fallback && fallback.key === emptyKey ? { kind: fallback.kind, place: fallback.place, items: fallback.items } : null,
    }),
    [hq, fallback, emptyKey]
  );
  const placeName = scopeNode ? displayName(scopeNode, lang) : null;
  const unreadNotifs = useNotifStore((s) => s.unreadCount());
  const userId = useAuthStore((s) => s.session?.user.id);
  const listRef = useRef<FlatList>(null);
  useScrollToTop(listRef);

  // Pull-to-refresh refetches the live data and keeps the current tab,
  // category, place and price order (only their own controls clear them). The
  // pull spinner is the indicator for a pull; the small inline spinner covers
  // every other trigger (Retry, tab re-tap, visit), so they never double up.
  // Success is silent; a failure shows the quiet Retry row below.
  const [pulling, setPulling] = useState(false);
  const onRefresh = useCallback(() => {
    setPulling(true);
    homeRefresh.refresh().finally(() => setPulling(false));
  }, []);
  const scopeScrollRef = useRef<ScrollView>(null);
  // x offset of each strip chip, so a reset can return to the active one.
  const scopeChipX = useRef<Record<number, number>>({});

  // Double-tap Home (homeRefresh.onHomeTabPress → reset): once the selections
  // are reset, scroll the whole list — header, categories and feed — to the top
  // and the location strip to the active place (the saved location is not reset,
  // so it stays selected; "All of …" when that is the active chip). Done from an
  // effect after the state change has been applied so it can't race the render.
  const [resetToken, setResetToken] = useState(0);
  useEffect(() => homeRefresh.onReset(() => setResetToken((n) => n + 1)), []);
  useEffect(() => {
    if (resetToken === 0) return;
    const id = requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      const x = scopeTarget.index > 0 ? scopeChipX.current[scopeTarget.index] : undefined;
      scopeScrollRef.current?.scrollTo({ x: x == null ? 0 : Math.max(0, x - spacing.md), animated: false });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a reset should scroll; the strip target is read at that moment
  }, [resetToken]);

  // What the list area shows while there are no rows: progress, a failure with Retry, or the empty state.
  const failed = feedState.status === 'error' || priceOptions.failed;
  const emptyBody = hq.needsLocation && !awaitingDirectory ? (
    <HomeEmpty
      feed={emptyFeed}
      numColumns={numColumns}
      categoryName={category?.name ?? null}
      placeName={placeName}
      onClearCategory={() => setActiveCategory(null)}
      onClearPlace={() => setScope(null)}
      onChoosePlace={() => setPickerOpen(true)}
      onBackToSelection={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
    />
  ) : failed ? (
    <ErrorState
      onRetry={() => {
        if (priceOptions.failed) priceOptions.retry();
        else void homeRefresh.refresh();
      }}
    />
  ) : feedState.status === 'ready' ? (
    <HomeEmpty
      feed={emptyFeed}
      numColumns={numColumns}
      categoryName={category?.name ?? null}
      placeName={placeName}
      onClearCategory={() => setActiveCategory(null)}
      onClearPlace={() => setScope(null)}
      onChoosePlace={() => setPickerOpen(true)}
      onBackToSelection={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
    />
  ) : (
    <FeedSkeleton numColumns={numColumns} />
  );

  return (
    <Screen edges={['top', 'left', 'right']} noPadding>
      <FlatList
        ref={listRef}
        key={numColumns}
        data={items}
        onEndReached={() => void homeFeed.loadMore()}
        onEndReachedThreshold={0.6}
        keyExtractor={(item) => item.id}
        numColumns={numColumns}
        columnWrapperStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={colors.primary} />}
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
            <AccountRestrictionBanner />

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
              {DISCOVERY_TABS.map((tab) => {
                const isPrice = tab === 'Price';
                const isActive = activeTab === tab;
                const label = isPrice && isActive ? t('home.priceActive', { order: priceOrder === 'asc' ? t('home.priceLowest') : t('home.priceHighest') }) : t(`home.tabs.${DISCOVERY_TAB_KEYS[tab]}`);
                return (
                  <Pressable
                    key={tab}
                    onPress={() => (isPrice ? setPriceMenuOpen(true) : setActiveTab(tab))}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={label}
                    style={{
                      paddingHorizontal: spacing.sm,
                      paddingVertical: 6,
                      borderRadius: radius.pill,
                      backgroundColor: isActive ? colors.primary : colors.surface,
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                  >
                    <Text variant="caption" color={isActive ? 'inverse' : 'secondary'}>
                      {label}
                    </Text>
                    {isPrice && <Ionicons name="chevron-down" size={12} color={isActive ? colors.primaryText : colors.textMuted} style={{ marginLeft: 4 }} />}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Modal visible={priceMenuOpen} animationType="fade" transparent onRequestClose={() => setPriceMenuOpen(false)}>
              <Pressable style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }} onPress={() => setPriceMenuOpen(false)} accessibilityLabel={t('common.close')} accessibilityRole="button">
                <Pressable style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, paddingBottom: spacing.xl }} onPress={(e) => e.stopPropagation()}>
                  <Text variant="h3" accessibilityRole="header" style={{ marginBottom: spacing.sm }}>
                    {t('home.priceMenuTitle')}
                  </Text>
                  {(['asc', 'desc'] as const).map((order) => {
                    const on = activeTab === 'Price' && priceOrder === order;
                    return (
                      <Pressable
                        key={order}
                        onPress={() => {
                          setPriceOrder(order);
                          setActiveTab('Price');
                          setPriceMenuOpen(false);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm }}
                      >
                        <Text variant="body" color={on ? 'brand' : 'primary'}>
                          {order === 'asc' ? t('home.priceLowest') : t('home.priceHighest')}
                        </Text>
                        {on && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                      </Pressable>
                    );
                  })}
                </Pressable>
              </Pressable>
            </Modal>
            {activeTab === 'Price' && hq.price && hq.price.options.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.xs }} contentContainerStyle={{ gap: spacing.xs }}>
                {hq.price.options.map((o) => {
                  const on = o.code === hq.price!.currency;
                  return (
                    <Pressable
                      key={o.code}
                      onPress={() => setPriceCurrency(o.code)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}
                    >
                      <Text variant="caption" color={on ? 'inverse' : 'primary'}>
                        {currencyLabel(o.code)} ({o.count})
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            <View style={{ marginTop: spacing.lg, marginBottom: spacing.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="h3" accessibilityRole="header">
                {t('home.exploreByLocation')}
              </Text>
              <Pressable onPress={() => setPickerOpen(true)} accessibilityRole="button" accessibilityLabel={t('home.changeLocation')} hitSlop={10}>
                <Ionicons name="search" size={20} color={colors.primary} />
              </Pressable>
            </View>
            {back && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs }}>
                {/* Always-visible way back: one level up (or All Locations from a country). */}
                <Pressable
                  onPress={() => setScope(back.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={back.node ? t('home.backTo', { name: displayName(back.node, lang) }) : t('home.showListingsAll')}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingLeft: 4, paddingRight: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary }}
                >
                  <Ionicons name="chevron-back" size={16} color={colors.primary} />
                  <Text variant="caption" color="brand">
                    {back.node ? displayName(back.node, lang) : t('home.allLocations')}
                  </Text>
                </Pressable>
                {back.node && (
                  <Pressable onPress={() => setScope(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('home.showListingsAll')}>
                    <Text variant="caption" color="primary">
                      {t('home.allLocations')}
                    </Text>
                  </Pressable>
                )}
                {crumbs.map((c, i) => (
                  <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="chevron-forward" size={12} color={colors.textMuted} />
                    <Pressable onPress={() => setScope(c.id)} accessibilityRole="button" accessibilityLabel={t('home.showListingsIn', { name: displayName(c, lang) })}>
                      <Text variant="caption" color={i === crumbs.length - 1 ? 'secondary' : 'primary'}>
                        {displayName(c, lang)}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            {/* Keyed by the level it lists, so a new scope (e.g. picking Tigray) remounts the strip at its start instead of keeping the old scroll offset. */}
            <ScrollView key={selector.parent?.id ?? 'root'} ref={scopeScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
              {selector.options.map((opt, i) => {
                const isActive = scopeId === opt.id;
                const label = opt.isAll ? (opt.node ? t('home.allIn', { name: displayName(opt.node, lang) }) : t('home.allLocations')) : displayName(opt.node!, lang);
                return (
                  <Pressable
                    key={opt.id ?? 'all'}
                    onPress={() => setScope(opt.id)}
                    onLayout={(e) => {
                      scopeChipX.current[i] = e.nativeEvent.layout.x;
                      // A specific child was selected (e.g. from the search picker): bring it into view once laid out.
                      if (isActive && i === scopeTarget.index && i > 0) scopeScrollRef.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - spacing.md), animated: false });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={opt.id === null ? t('home.showListingsAll') : t('home.showListingsIn', { name: label })}
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
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <KeyboardSheet visible={pickerOpen} onClose={() => setPickerOpen(false)}>
              <LocationList
                selected={scopeNode?.name}
                allowRequest={false}
                onSelect={(loc) => {
                  setScope(loc.id);
                  setPickerOpen(false);
                }}
              />
            </KeyboardSheet>

            <Text variant="h3" accessibilityRole="header" style={{ marginTop: spacing.md }}>
              {t(`home.tabs.${DISCOVERY_TAB_KEYS[activeTab]}`)}
            </Text>
            {(category || placeName) && (
              <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
                {[category?.name, placeName].filter(Boolean).join(' · ')}
              </Text>
            )}
            {activeTab === 'Nearby' && hq.nearbyAnchor && (
              <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
                {t('home.nearbyNote', { place: displayName(hq.nearbyAnchor, lang) })}
              </Text>
            )}
            {activeTab === 'Price' && hq.price && (
              <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
                {t('home.priceCurrencyNote')}
                {hq.price.hiddenOther > 0 ? ` ${t('home.priceOtherCurrencies', { count: hq.price.hiddenOther })}` : ''}
              </Text>
            )}
            <View style={{ marginTop: spacing.xs, marginBottom: spacing.sm, minHeight: 20, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }} accessibilityLiveRegion="polite">
              {refresh.refreshing ? (
                pulling ? null : <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={t('home.updating')} />
              ) : refresh.failed ? (
                <>
                  <Ionicons name="cloud-offline-outline" size={14} color={colors.textMuted} />
                  <Text variant="tiny" color="secondary" style={{ flexShrink: 1 }}>
                    {t('home.refreshFailed')}
                  </Text>
                  <Pressable onPress={() => homeRefresh.refresh()} hitSlop={10} accessibilityRole="button">
                    <Text variant="tiny" color="brand">
                      {t('home.tryAgain')}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={emptyBody}
        ListFooterComponent={
          <FeedFooter
            count={items.length}
            loadingMore={feedState.loadingMore}
            moreFailed={feedState.moreFailed}
            hasMore={feedState.hasMore}
            ready={feedState.status === 'ready'}
            onRetry={() => void homeFeed.loadMore()}
          />
        }
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
      />
    </Screen>
  );
}
