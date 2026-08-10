import { useEffect, useMemo, useState } from 'react';
import { View, FlatList, Pressable, ScrollView, RefreshControl } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { ListingCard } from '@/components/ListingCard';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { useTheme } from '@/theme/ThemeContext';
import { useListingsStore, resolveAllListings } from '@/store/listings';
import { useLocationStore } from '@/store/location';
import { useSavedSearchStore } from '@/store/savedSearches';
import { useSearchHistoryStore } from '@/store/searchHistory';
import { requireAuth } from '@/store/authPrompt';
import { useResponsiveColumns } from '@/hooks/useResponsiveColumns';
import { useBlockedEitherWayIds, filterBlockedSellers } from '@/lib/blocking';

const FILTERS = ['Verified only', 'Price reduced', 'Negotiable', 'Posted today'];

export default function Search() {
  const { colors, spacing, radius } = useTheme();
  const numColumns = useResponsiveColumns();
  const params = useLocalSearchParams<{ category?: string }>();
  const [query, setQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const globalListings = useListingsStore((s) => s.listings);
  const blockedIds = useBlockedEitherWayIds();
  const currentCity = useLocationStore((s) => s.city);
  const allListings = useMemo(() => filterBlockedSellers(resolveAllListings(globalListings), blockedIds), [globalListings, blockedIds]);
  const addSavedSearch = useSavedSearchStore((s) => s.add);
  const recentQueries = useSearchHistoryStore((s) => s.queries);
  const recordQuery = useSearchHistoryStore((s) => s.record);
  const clearHistory = useSearchHistoryStore((s) => s.clear);

  const toggleFilter = (f: string) => setActiveFilters((s) => (s.includes(f) ? s.filter((x) => x !== f) : [...s, f]));

  // Simulates the network round-trip a real search-as-you-type would make,
  // then records the settled query to search history once typing pauses.
  useEffect(() => {
    if (!query) return;
    setSearching(true);
    const t = setTimeout(() => {
      setSearching(false);
      recordQuery(query);
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const results = useMemo(() => {
    return allListings.filter((l) => {
      const matchesQuery = query ? l.title.toLowerCase().includes(query.toLowerCase()) : true;
      const matchesCategory = params.category ? l.category === params.category : true;
      const matchesCity = currentCity ? l.city === currentCity : true;
      return matchesQuery && matchesCategory && matchesCity;
    });
  }, [allListings, query, params.category, currentCity]);

  return (
    <Screen>
      <View style={{ paddingTop: spacing.sm }}>
        <Input
          placeholder="Search phones, cars, furniture..."
          value={query}
          onChangeText={setQuery}
          leftIcon={<Ionicons name="search" size={18} color={colors.textMuted} />}
          rightIcon={
            query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            ) : undefined
          }
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }} contentContainerStyle={{ gap: spacing.xs }}>
          {FILTERS.map((f) => {
            const active = activeFilters.includes(f);
            return (
              <Pressable
                key={f}
                onPress={() => toggleFilter(f)}
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
                  {f}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {!query && recentQueries.length > 0 && (
          <View style={{ marginTop: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
              <Text variant="caption" color="secondary">
                Recent searches
              </Text>
              <Pressable onPress={clearHistory} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear recent searches">
                <Text variant="caption" color="brand">
                  Clear
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

      {searching ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <View key={i} style={{ flex: 1, gap: spacing.xs }}>
              <Skeleton height={140} radius={radius.md} />
              <Skeleton height={14} />
              <Skeleton width="60%" height={14} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          key={numColumns}
          data={results}
          keyExtractor={(item) => item.id}
          numColumns={numColumns}
          columnWrapperStyle={{ gap: spacing.sm }}
          contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.xxl }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                useListingsStore.getState().load().finally(() => setRefreshing(false));
              }}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <View style={{ flex: 1 }}>
              <ListingCard listing={item} />
            </View>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="search-outline"
              title="Nothing matches yet"
              message="Try a different search, or save it and we'll notify you when something matches."
              actionLabel="Save this search"
              onAction={() =>
                requireAuth(() => addSavedSearch(query || 'All items', activeFilters.length ? activeFilters.join(', ') : 'No filters'))
              }
            />
          }
        />
      )}
    </Screen>
  );
}
