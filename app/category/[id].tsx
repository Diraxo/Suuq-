import { useMemo, useState } from 'react';
import { View, FlatList, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CategoryIcon } from '@/components/CategoryIcon';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ListingCard } from '@/components/ListingCard';
import { useTheme } from '@/theme/ThemeContext';
import { categories } from '@/data/categories';
import { useListingsStore, resolveAllListings } from '@/store/listings';
import { useBlockedEitherWayIds, filterBlockedSellers } from '@/lib/blocking';

export default function CategoryDetail() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const category = categories.find((c) => c.id === id) ?? categories[0];
  const [sub, setSub] = useState<string | null>(null);
  const allListings = useListingsStore((s) => s.listings);
  const blockedIds = useBlockedEitherWayIds();
  const listings = useMemo(
    () => filterBlockedSellers(resolveAllListings(allListings), blockedIds).filter((l) => l.category === category.id && (!sub || l.subcategory === sub)),
    [allListings, blockedIds, category.id, sub]
  );

  return (
    <Screen edges={['top', 'left', 'right']} noPadding>
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <BackButton onPress={() => router.back()} />
          <CategoryIcon icon={category.icon} size={20} color={colors.primary} style={{ marginLeft: spacing.sm }} />
          <Text variant="h2" style={{ marginLeft: spacing.xs }}>
            {category.name}
          </Text>
        </View>
      </View>

      <FlatList
        data={listings}
        keyExtractor={(l) => l.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
        ListHeaderComponent={
          category.subcategories ? (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={category.subcategories}
              keyExtractor={(s) => s.name}
              contentContainerStyle={{ gap: spacing.xs, paddingHorizontal: spacing.md, marginVertical: spacing.sm }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => setSub(sub === item.name ? null : item.name)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 6,
                    borderRadius: radius.pill,
                    backgroundColor: sub === item.name ? colors.primary : colors.surface,
                  }}
                >
                  <CategoryIcon icon={item.icon} size={14} color={sub === item.name ? colors.primaryText : colors.primary} />
                  <Text variant="caption" color={sub === item.name ? 'inverse' : 'secondary'} style={{ marginLeft: 4 }}>
                    {item.name}
                  </Text>
                </Pressable>
              )}
            />
          ) : null
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
