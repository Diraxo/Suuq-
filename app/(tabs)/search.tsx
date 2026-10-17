import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { View, FlatList, Pressable, ScrollView, RefreshControl, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { ListingCard } from '@/components/ListingCard';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { useTheme } from '@/theme/ThemeContext';
import { useLocationStore } from '@/store/location';
import { useListingsStore } from '@/store/listings';
import { useLocationsStore } from '@/store/locations';
import { LocNode, displayName, pathLabel, searchLocations, toLang } from '@/lib/locationTree';
import { useSavedSearchStore } from '@/store/savedSearches';
import { useSearchHistoryStore } from '@/store/searchHistory';
import { requireAuth } from '@/store/authPrompt';
import { useResponsiveColumns } from '@/hooks/useResponsiveColumns';
import { useBlockedEitherWayIds, filterBlockedSellers } from '@/lib/blocking';
import { Listing } from '@/types';
import { fetchSearchPage, SearchPage } from '@/lib/searchApi';
import { initialSession, sessionReducer } from '@/lib/searchSession';
import {
  FILTER_IDS,
  FilterId,
  FilterState,
  NO_FILTERS,
  SEARCH_DEBOUNCE_MS,
  SearchInput,
  activeFilterIds,
  hasActiveFilters,
  recommendationSearches,
  recoveryActions,
  searchKey,
  toggleFilter,
} from '@/lib/searchFilters';
import { createLatestGuard } from '@/lib/refreshController';
import { registerKnownListingIds, useVisibilityStore, withoutHidden } from '@/store/visibility';

// i18n key per filter id — the ids themselves are what the search API and the saved-search
// description use, so they stay stable while only the rendered label is translated.
const FILTER_LABEL_KEYS: Record<FilterId, string> = {
  verified: 'verifiedOnly',
  boostedToday: 'boostedToday',
  priceReduced: 'priceReduced',
  negotiable: 'negotiable',
  postedToday: 'postedToday',
};

export default function Search() {
  const { colors, spacing, radius } = useTheme();
  const { t, i18n } = useTranslation();
  const lang = toLang(i18n.language);
  const router = useRouter();
  const numColumns = useResponsiveColumns();
  const params = useLocalSearchParams<{ category?: string }>();
  const category = params.category || null;
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [recs, setRecs] = useState<Listing[]>([]);
  const blockedIds = useBlockedEitherWayIds();
  const scopeId = useLocationStore((s) => s.scopeId);
  const setScope = useLocationStore((s) => s.setScope);
  const locIndex = useLocationsStore((s) => s.index);
  const addSavedSearch = useSavedSearchStore((s) => s.add);
  const recentQueries = useSearchHistoryStore((s) => s.queries);
  const recordQuery = useSearchHistoryStore((s) => s.record);
  const clearHistory = useSearchHistoryStore((s) => s.clear);

  const [session, dispatch] = useReducer(sessionReducer<Listing>, undefined, initialSession<Listing>);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const guard = useRef(createLatestGuard()).current;

  // Typing is debounced; clearing the box applies immediately. Filter chips apply immediately.
  useEffect(() => {
    if (!query.trim()) {
      setDebouncedQuery('');
      return;
    }
    const id = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Records the settled query to search history once typing pauses.
  useEffect(() => {
    if (!debouncedQuery.trim()) return;
    const id = setTimeout(() => recordQuery(debouncedQuery), 50);
    return () => clearTimeout(id);
  }, [debouncedQuery]);

  const input: SearchInput = useMemo(() => ({ query: debouncedQuery, category, scopeId, filters }), [debouncedQuery, category, scopeId, filters]);
  const key = searchKey(input);

  // First page for the current search. Responses to a superseded search/refresh carry an old ticket and are dropped.
  useEffect(() => {
    const ticket = guard.next();
    dispatch({ type: 'begin', key, ticket });
    fetchSearchPage(input)
      .then((page: SearchPage) => {
        // The listing detail screen resolves from the global store: make sure every result can be opened.
        useListingsStore.getState().mergeFetched(page.items);
        dispatch({ type: 'success', ticket, page });
      })
      .catch((e) => {
        if (__DEV__) console.error('[search] failed:', e?.message ?? e);
        dispatch({ type: 'failure', ticket });
      });
    // `input` is fully determined by `key`; refreshNonce re-runs the same search (pull-to-refresh / Retry).
  }, [key, refreshNonce]);

  const loadMore = useCallback(() => {
    const s = sessionRef.current;
    if (s.status !== 'ready' || !s.hasMore || s.loadingMore || !s.cursor) return;
    const ticket = s.ticket;
    dispatch({ type: 'beginMore', ticket });
    fetchSearchPage(input, s.cursor)
      .then((page) => {
        useListingsStore.getState().mergeFetched(page.items);
        dispatch({ type: 'moreSuccess', ticket, page });
      })
      .catch(() => dispatch({ type: 'moreFailure', ticket }));
  }, [input]);

  const retry = () => setRefreshNonce((n) => n + 1);

  // Listings staff hid since this screen loaded disappear immediately (real-time + reconciled on reconnect).
  const hidden = useVisibilityStore((s) => s.hidden);
  const results = useMemo(() => withoutHidden(filterBlockedSellers(session.items, blockedIds), hidden), [session.items, blockedIds, hidden]);
  useEffect(() => registerKnownListingIds(session.items.map((l) => l.id)), [session.items]);
  const isEmpty = session.status === 'ready' && results.length === 0;

  // Real, eligible recommendations when nothing matched — newest eligible listings, in the same category if one
  // was chosen, never the query/filters that produced the empty set.
  useEffect(() => {
    setRecs([]);
    if (!isEmpty) return;
    let live = true;
    (async () => {
      for (const alt of recommendationSearches(input)) {
        try {
          const page = await fetchSearchPage(alt, null, 6);
          const visible = filterBlockedSellers(page.items, blockedIds);
          if (!live) return;
          if (visible.length > 0) {
            useListingsStore.getState().mergeFetched(visible);
            setRecs(visible);
            return;
          }
        } catch {
          return; // recommendations are optional; the empty state still works without them
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [isEmpty, key]);

  // Places from the approved directory that the typed text names; when nothing
  // else matched, "did you mean" alternatives for a misspelling (never auto-applied).
  const places = useMemo(() => {
    if (!query.trim()) return { items: [] as LocNode[], isSuggestion: false };
    const found = searchLocations(locIndex, query, lang);
    if (found.matches.length) return { items: found.matches.slice(0, 3), isSuggestion: false };
    return { items: isEmpty ? found.suggestions.slice(0, 3) : [], isSuggestion: true };
  }, [locIndex, query, lang, isEmpty]);

  const filterText = () => {
    const ids = activeFilterIds(filters);
    return ids.length ? ids.map((id) => t(`search.filters.${FILTER_LABEL_KEYS[id]}`)).join(', ') : t('search.noFilters');
  };

  const runRecovery = (action: ReturnType<typeof recoveryActions>[number]) => {
    switch (action) {
      case 'clearFilters':
        return setFilters(NO_FILTERS);
      case 'clearSearch':
        setQuery('');
        return setDebouncedQuery('');
      case 'clearCategory':
        return router.setParams({ category: '' });
      case 'clearLocation':
        return setScope(null);
      case 'saveSearch':
        return requireAuth(() => addSavedSearch(query || t('search.allItemsFallback'), filterText()));
    }
  };
  const recoveryLabel: Record<ReturnType<typeof recoveryActions>[number], string> = {
    clearFilters: t('search.clearFilters'),
    clearSearch: t('search.clearSearch'),
    clearCategory: t('search.clearCategory'),
    clearLocation: t('search.clearLocation'),
    saveSearch: t('search.saveThisSearch'),
  };

  const loadingFirst = session.status === 'loading' && results.length === 0;

  return (
    <Screen>
      {/* Resizes the content area by however much of it the keyboard actually covers, so the input and results stay visible on any screen size. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={{ paddingTop: spacing.sm }}>
        <Input
          placeholder={t('home.searchPlaceholder')}
          value={query}
          onChangeText={setQuery}
          leftIcon={<Ionicons name="search" size={18} color={colors.textMuted} />}
          rightIcon={
            query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('search.clearSearch')}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            ) : undefined
          }
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }} contentContainerStyle={{ gap: spacing.xs }}>
          {FILTER_IDS.map((id) => {
            const active = filters[id];
            return (
              <Pressable
                key={id}
                onPress={() => setFilters((f) => toggleFilter(f, id))}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 6,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primary + '0D' : colors.surface,
                }}
              >
                <Text variant="caption" color={active ? 'brand' : 'secondary'}>
                  {t(`search.filters.${FILTER_LABEL_KEYS[id]}`)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {places.items.length > 0 && (
          <View style={{ marginTop: spacing.sm }} accessibilityLiveRegion="polite">
            <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
              {places.isSuggestion ? t('components.locationList.noExactMatch', { query: query.trim() }) : t('search.places')}
            </Text>
            <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
              {places.items.map((node) => {
                const on = scopeId === node.id;
                const where = pathLabel(locIndex, node.id, lang);
                return (
                  <Pressable
                    key={node.id}
                    onPress={() => setScope(node.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={t('home.showListingsIn', { name: displayName(node, lang) })}
                    style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}
                  >
                    <Text variant="caption" color={on ? 'inverse' : 'primary'}>
                      {displayName(node, lang)}
                    </Text>
                    {where ? (
                      <Text variant="tiny" color={on ? 'inverse' : 'muted'}>
                        {where}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {!query && recentQueries.length > 0 && (
          <View style={{ marginTop: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
              <Text variant="caption" color="secondary">
                {t('search.recentSearches')}
              </Text>
              <Pressable onPress={clearHistory} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('search.clearRecentSearches')}>
                <Text variant="caption" color="brand">
                  {t('search.clear')}
                </Text>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
              {recentQueries.map((q) => (
                <Pressable
                  key={q}
                  onPress={() => setQuery(q)}
                  style={{
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 6,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  }}
                >
                  <Text variant="caption" color="secondary">
                    {q}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

        {session.status === 'error' ? (
          <ErrorState title={t('search.errorTitle')} message={t('search.errorMessage')} onRetry={retry} />
        ) : (
          <FlatList
            key={numColumns}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            automaticallyAdjustKeyboardInsets
            data={loadingFirst ? [] : results}
            keyExtractor={(item) => item.id}
            numColumns={numColumns}
            columnWrapperStyle={numColumns > 1 ? { gap: spacing.sm } : undefined}
            contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.xxl, opacity: session.status === 'loading' && !loadingFirst ? 0.6 : 1 }}
            onEndReached={loadMore}
            onEndReachedThreshold={0.6}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  retry();
                  setTimeout(() => setRefreshing(false), 600);
                }}
                tintColor={colors.primary}
              />
            }
            renderItem={({ item }) => (
              <View style={{ flex: 1 }}>
                <ListingCard listing={item} />
              </View>
            )}
            ListFooterComponent={
              session.loadingMore ? (
                <View style={{ paddingVertical: spacing.md }} accessibilityLabel={t('search.loadingMore')}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : session.moreFailed ? (
                <View style={{ alignItems: 'center', paddingVertical: spacing.md }}>
                  <Button label={t('search.retry')} variant="outline" size="sm" onPress={loadMore} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              loadingFirst ? (
                <View style={{ paddingVertical: spacing.xxl }}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : (
                <View>
                  <EmptyState
                    icon="search-outline"
                    title={hasActiveFilters(filters) ? t('search.emptyFilteredTitle') : t('search.emptyTitle')}
                    message={hasActiveFilters(filters) ? t('search.emptyFilteredMessage') : debouncedQuery.trim() ? t('search.emptyMessage') : t('search.emptyBrowseMessage')}
                  />
                  {recoveryActions(input).length > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.xs, marginTop: -spacing.md, marginBottom: spacing.lg }}>
                      {recoveryActions(input).map((action, i) => (
                        <Button key={action} label={recoveryLabel[action]} variant={i === 0 ? 'primary' : 'outline'} size="sm" onPress={() => runRecovery(action)} />
                      ))}
                    </View>
                  )}
                  {recs.length > 0 && (
                    <View>
                      <Text variant="h3" style={{ marginBottom: spacing.sm }}>
                        {t('search.recommended')}
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                        {recs.map((l) => (
                          <View key={l.id} style={{ width: numColumns > 2 ? '31%' : '48%' }}>
                            <ListingCard listing={l} />
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              )
            }
          />
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
