import { useMemo, useState } from 'react';
import { View, FlatList, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Badge } from '@/components/Badge';
import { ListingCard } from '@/components/ListingCard';
import { useTheme } from '@/theme/ThemeContext';
import { useLocationsStore } from '@/store/locations';
import { useBlockedEitherWayIds, filterBlockedSellers } from '@/lib/blocking';
import { useVisibilityStore, withoutHidden } from '@/store/visibility';
import { usePagedFeed, useScreenFeed } from '@/hooks/usePagedFeed';
import { BASE_QUERY } from '@/lib/homeFeedPaging';
import { FeedFooter, FeedSkeleton } from '@/components/FeedParts';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { useResponsiveColumns } from '@/hooks/useResponsiveColumns';

const TAB_KEYS = ['trending', 'newest', 'nearby', 'popularSellers'] as const;

export default function CityPage() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name: string }>();
  const [tab, setTab] = useState<(typeof TAB_KEYS)[number]>(TAB_KEYS[0]);
  const numColumns = useResponsiveColumns();
  const isFeatured = useLocationsStore((s) => s.index.nodes.some((c) => c.isFeatured && c.name === name));
  const blockedIds = useBlockedEitherWayIds();
  const hidden = useVisibilityStore((s) => s.hidden);
  // The city is a filter in the database query (home_feed), one page at a time — not a filter over every listing.
  const query = useMemo(() => (name ? { ...BASE_QUERY, city: name } : null), [name]);
  const feed = useScreenFeed(query);
  const state = usePagedFeed(feed);
  const listings = useMemo(() => withoutHidden(filterBlockedSellers(state.items, blockedIds), hidden), [state.items, blockedIds, hidden]);

  return (
    <Screen edges={['top', 'left', 'right']} noPadding>
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <BackButton onPress={() => router.back()} />
          <Text variant="h2" style={{ marginLeft: spacing.sm }}>
            {name}
          </Text>
          {isFeatured && <Badge label={t('city.featuredCity')} tone="brand" />}
        </View>
      </View>

      <FlatList
        key={numColumns}
        data={listings}
        keyExtractor={(l) => l.id}
        numColumns={numColumns}
        onEndReached={() => void feed.loadMore()}
        onEndReachedThreshold={0.6}
        columnWrapperStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
        ListHeaderComponent={
          <View style={{ flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, marginVertical: spacing.sm }}>
            {TAB_KEYS.map((key) => (
              <Pressable
                key={key}
                onPress={() => setTab(key)}
                style={{
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: tab === key ? colors.primary : colors.surface,
                }}
              >
                <Text variant="caption" color={tab === key ? 'inverse' : 'secondary'}>
                  {t(`city.tabs.${key}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ flex: 1 }}>
            <ListingCard listing={item} />
          </View>
        )}
        ListEmptyComponent={
          state.status === 'error' ? (
            <ErrorState onRetry={() => void feed.refresh()} />
          ) : state.status === 'ready' ? (
            <EmptyState icon="location-outline" title={t('home.emptyTitle')} message={t('home.emptyPlace', { place: name })} />
          ) : (
            <FeedSkeleton numColumns={numColumns} />
          )
        }
        ListFooterComponent={
          <FeedFooter count={listings.length} loadingMore={state.loadingMore} moreFailed={state.moreFailed} hasMore={state.hasMore} ready={state.status === 'ready'} onRetry={() => void feed.loadMore()} />
        }
      />
    </Screen>
  );
}
