import { View, FlatList, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useReviewsStore } from '@/store/reviews';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { requireAuth } from '@/store/authPrompt';
import { imageUrl } from '@/lib/r2';

export default function Reviews() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const reviews = useReviewsStore((s) => s.reviews);

  if (!authed) return <Screen />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('seller.reviews')}
        </Text>
      </View>

      <FlatList
        data={reviews}
        keyExtractor={(r) => r.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Image source={{ uri: imageUrl(item.reviewer.avatar, { width: 100 }) }} accessibilityLabel={t('listing.sellerPhotoAlt', { name: item.reviewer.name })} style={{ width: 36, height: 36, borderRadius: 18 }} cachePolicy="memory-disk" recyclingKey={item.reviewer.avatar} transition={200} />
              <View style={{ marginLeft: spacing.xs, flex: 1 }}>
                <Text variant="bodyMedium">{item.reviewer.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Ionicons key={i} name={i < item.rating ? 'star' : 'star-outline'} size={18} color={colors.warning} />
                  ))}
                </View>
              </View>
              <Pressable
                onPress={() => requireAuth(() => router.push(`/report?type=review&id=${item.id}` as any))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('reviews.reportReview')}
              >
                <Ionicons name="flag-outline" size={18} color={colors.textMuted} />
              </Pressable>
            </View>
            {!!item.comment && (
              <Text variant="body" color="secondary" style={{ marginTop: spacing.xs }}>
                {item.comment}
              </Text>
            )}
          </Card>
        )}
        ListEmptyComponent={<EmptyState icon="star-outline" title={t('reviews.emptyTitle')} message={t('reviews.emptyMessage')} />}
      />
    </Screen>
  );
}
