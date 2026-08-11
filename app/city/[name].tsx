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
import { useListingsStore, resolveAllListings } from '@/store/listings';
import { featuredCities } from '@/data/categories';
import { useBlockedEitherWayIds, filterBlockedSellers } from '@/lib/blocking';

const TAB_KEYS = ['trending', 'newest', 'nearby', 'popularSellers'] as const;

export default function CityPage() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name: string }>();
  const [tab, setTab] = useState<(typeof TAB_KEYS)[number]>(TAB_KEYS[0]);
  const allListings = useListingsStore((s) => s.listings);
  const blockedIds = useBlockedEitherWayIds();
  const listings = useMemo(() => filterBlockedSellers(resolveAllListings(allListings), blockedIds).filter((l) => l.city === name), [allListings, blockedIds, name]);

  return (
    <Screen edges={['top', 'left', 'right']} noPadding>
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <BackButton onPress={() => router.back()} />
          <Text variant="h2" style={{ marginLeft: spacing.sm }}>
            {name}
          </Text>
          {featuredCities.includes(name ?? '') && <Badge label={t('city.featuredCity')} tone="brand" />}
        </View>
      </View>

      <FlatList
        data={listings}
        keyExtractor={(l) => l.id}
        numColumns={2}
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
      />
    </Screen>
  );
}
