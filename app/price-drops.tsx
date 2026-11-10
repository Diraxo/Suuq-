import { View, FlatList, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useMyListingsStore } from '@/store/myListings';
import { resolveListing } from '@/store/listings';
import { formatBirr } from '@/lib/currency';
import { activeDiscount, discountEndsText } from '@/lib/discount';
import { isContactPriceListing } from '@/data/serviceConfig';
import type { Listing } from '@/types';

type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'running'; key: string; listing: Listing }
  | { kind: 'earlier'; key: string; listing: Listing; oldPrice: number };

// The seller's Discounts screen: discounts running now (badge, old and new price, savings, countdown, note), then earlier
// plain price reductions from the price history, shown with the same percent so the two read alike.
export default function PriceDrops() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const myListings = useMyListingsStore((s) => s.listings);
  const priceDrops = useMyListingsStore((s) => s.priceDrops);

  const running = myListings.filter((l) => activeDiscount(l));
  const runningIds = new Set(running.map((l) => l.id));
  const earlier = priceDrops
    .filter((d) => !runningIds.has(d.listingId))
    .map((d) => ({ listing: resolveListing(d.listingId, myListings), oldPrice: d.oldPrice }))
    .filter((d): d is { listing: Listing; oldPrice: number } => !!d.listing && !isContactPriceListing(d.listing));

  const rows: Row[] = [];
  if (running.length) {
    rows.push({ kind: 'header', key: 'h-running', label: t('discount.runningNow') });
    for (const l of running) rows.push({ kind: 'running', key: `r-${l.id}`, listing: l });
  }
  if (earlier.length) {
    rows.push({ kind: 'header', key: 'h-earlier', label: t('discount.earlierReductions') });
    for (const d of earlier) rows.push({ kind: 'earlier', key: `e-${d.listing.id}`, listing: d.listing, oldPrice: d.oldPrice });
  }

  const open = (id: string) => router.push(`/listing/${id}`);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('priceDrops.title')}
        </Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return (
              <Text variant="bodyMedium" color="muted" style={{ marginTop: spacing.xs }}>
                {item.label}
              </Text>
            );
          }
          const l = item.listing;
          if (item.kind === 'running') {
            const d = activeDiscount(l)!;
            const ends = discountEndsText(d, t);
            return (
              <Pressable onPress={() => open(l.id)}>
                <Card>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text variant="bodyMedium" numberOfLines={1} style={{ flex: 1, marginRight: spacing.sm }}>
                      {l.title}
                    </Text>
                    <Badge label={t('components.listingCard.discountOff', { percent: d.percent })} tone="sale" />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: spacing.xs, marginTop: 4 }}>
                    <Text variant="h3" color="success">
                      {formatBirr(l.price, l.currency)}
                    </Text>
                    <Text variant="caption" color="muted" style={{ textDecorationLine: 'line-through' }}>
                      {formatBirr(d.originalPrice, l.currency)}
                    </Text>
                  </View>
                  <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
                    {t('listing.discountSave', { amount: formatBirr(d.originalPrice - l.price, l.currency) })}
                  </Text>
                  {ends && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                      <Text variant="caption" color="muted" style={{ marginLeft: 4 }}>
                        {ends}
                      </Text>
                    </View>
                  )}
                  {d.note ? (
                    <Text variant="caption" style={{ marginTop: 4 }}>
                      {d.note}
                    </Text>
                  ) : null}
                </Card>
              </Pressable>
            );
          }
          const pct = item.oldPrice > 0 ? Math.round((1 - l.price / item.oldPrice) * 100) : 0;
          return (
            <Pressable onPress={() => open(l.id)}>
              <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium" numberOfLines={1}>
                    {l.title}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', columnGap: spacing.xs, marginTop: 4 }}>
                    <Text variant="caption" color="muted" style={{ textDecorationLine: 'line-through' }}>
                      {formatBirr(item.oldPrice, l.currency)}
                    </Text>
                    <Text variant="h3" color="success">
                      {formatBirr(l.price, l.currency)}
                    </Text>
                  </View>
                </View>
                {pct >= 1 && <Badge label={t('components.listingCard.discountOff', { percent: pct })} tone="neutral" />}
              </Card>
            </Pressable>
          );
        }}
        ListEmptyComponent={<EmptyState icon="pricetag-outline" title={t('priceDrops.emptyTitle')} message={t('priceDrops.emptyMessage')} />}
      />
    </Screen>
  );
}
