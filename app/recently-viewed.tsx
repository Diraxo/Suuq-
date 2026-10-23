import { useMemo } from 'react';
import { View, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ListingCard } from '@/components/ListingCard';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useRecentlyViewedStore } from '@/store/recentlyViewed';
import { useListings } from '@/hooks/useListings';
import { Skeleton } from '@/components/Skeleton';

export default function RecentlyViewed() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const viewedIds = useRecentlyViewedStore((s) => s.viewedIds);
  // Only the viewed ids are requested (batched). Anything no longer visible (removed, blocked) is skipped.
  const { items, loading, failed, refresh } = useListings(viewedIds);
  const viewed = useMemo(() => {
    const byId = new Map(items.map((l) => [l.id, l]));
    return viewedIds.map((id) => byId.get(id)).filter((l): l is NonNullable<typeof l> => !!l);
  }, [viewedIds, items]);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('recentlyViewed.title')}
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
        ListEmptyComponent={
          loading ? (
            <View style={{ gap: spacing.sm }}>
              <Skeleton height={120} />
              <Skeleton height={120} />
            </View>
          ) : failed ? (
            <EmptyState icon="cloud-offline-outline" title={t('listing.loadError.title')} message={t('listing.loadError.message')} actionLabel={t('listing.loadError.retry')} onAction={() => void refresh()} />
          ) : (
            <EmptyState icon="time-outline" title={t('recentlyViewed.emptyTitle')} message={t('recentlyViewed.emptyMessage')} />
          )
        }
      />
    </Screen>
  );
}
