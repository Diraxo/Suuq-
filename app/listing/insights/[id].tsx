import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useListingsStore, resolveListing } from '@/store/listings';
import { useMyListingsStore } from '@/store/myListings';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';

export default function ListingInsights() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const { id } = useLocalSearchParams<{ id: string }>();
  const allListings = useListingsStore((s) => s.listings);
  const priceDrops = useMyListingsStore((s) => s.priceDrops);
  const listing = resolveListing(id, allListings);

  if (!authed) return <Screen />;
  if (!listing) {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
          <BackButton onPress={() => router.back()} />
        </View>
        <EmptyState icon="alert-circle-outline" title={t('listing.notFound.title')} message={t('listing.notFound.message')} actionLabel={t('listing.goBack')} onAction={() => router.back()} />
      </Screen>
    );
  }

  const priceDropCount = priceDrops.filter((d) => d.listingId === listing.id).length;

  const metrics = [
    { icon: 'eye-outline', label: t('listing.insights.views'), value: listing.views },
    { icon: 'heart-outline', label: t('listing.insights.favorites'), value: listing.favoritesCount },
    { icon: 'trending-down-outline', label: t('listing.insights.priceDrops'), value: priceDropCount },
  ] as const;

  const dateFields = [
    { label: t('listing.insights.created'), value: listing.createdAt ? new Date(listing.createdAt).toLocaleDateString() : '—' },
    { label: t('listing.insights.lastUpdated'), value: listing.updatedAt ? new Date(listing.updatedAt).toLocaleDateString() : '—' },
  ];

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('listing.insights.title')}
        </Text>
      </View>

      <Text variant="bodyMedium" numberOfLines={1} style={{ marginBottom: spacing.md }}>
        {listing.title}
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {metrics.map((m) => (
          <Card key={m.label} style={{ width: '47%' }}>
            <Ionicons name={m.icon as any} size={18} color={colors.primary} />
            <Text variant="h1" style={{ marginTop: spacing.xs }}>
              {m.value}
            </Text>
            <Text variant="caption" color="secondary">
              {m.label}
            </Text>
          </Card>
        ))}
      </View>

      <Card style={{ marginTop: spacing.md }} elevated={false}>
        <Text variant="bodyMedium" style={{ marginBottom: spacing.xs }}>
          {t('listing.insights.timeline')}
        </Text>
        <View style={{ gap: spacing.xs }}>
          {dateFields.map((f) => (
            <View key={f.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="caption" color="secondary">
                {f.label}
              </Text>
              <Text variant="caption" color="primary">
                {f.value}
              </Text>
            </View>
          ))}
        </View>
      </Card>
    </Screen>
  );
}
