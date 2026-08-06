import { View, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useMyListingsStore } from '@/store/myListings';
import { resolveListing } from '@/store/listings';
import { formatBirr } from '@/lib/currency';

export default function PriceDrops() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const myListings = useMyListingsStore((s) => s.listings);
  const priceDrops = useMyListingsStore((s) => s.priceDrops);
  const drops = priceDrops
    .map((d) => ({ listing: resolveListing(d.listingId, myListings), oldPrice: d.oldPrice }))
    .filter((d): d is { listing: NonNullable<typeof d.listing>; oldPrice: number } => !!d.listing);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Price Drops
        </Text>
      </View>

      <FlatList
        data={drops}
        keyExtractor={(d) => d.listing.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyMedium" numberOfLines={1}>
                {item.listing.title}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4 }}>
                <Text variant="caption" color="muted" style={{ textDecorationLine: 'line-through' }}>
                  {formatBirr(item.oldPrice)}
                </Text>
                <Text variant="h3" color="success">
                  {formatBirr(item.listing.price)}
                </Text>
              </View>
            </View>
            <Ionicons name="trending-down" size={20} color={colors.success} />
          </Card>
        )}
        ListEmptyComponent={<EmptyState icon="trending-down-outline" title="No price drops" message="We'll notify you when a favorite gets cheaper." />}
      />
    </Screen>
  );
}
