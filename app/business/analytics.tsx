import { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import {
  getSellerStats,
  getListingViewsSince,
  getMessagesReceivedSince,
  getItemsSoldSince,
  getTopCategoryAndCity,
  SellerStats,
  TopBreakdown,
} from '@/lib/sellerStats';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';

const EMPTY_STATS: SellerStats = { listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 };

export default function BusinessAnalytics() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const session = useAuthStore((s) => s.session);
  const [range, setRange] = useState<'weekly' | 'monthly'>('weekly');

  const [lifetime, setLifetime] = useState<SellerStats>(EMPTY_STATS);
  const [windowed, setWindowed] = useState({ views: 0, messages: 0, sold: 0 });
  const [top, setTop] = useState<{ topCategory: TopBreakdown; topCity: TopBreakdown }>({ topCategory: null, topCity: null });

  useEffect(() => {
    if (!session) return;
    Promise.all([getSellerStats(session.user.id), getTopCategoryAndCity(session.user.id)]).then(([stats, breakdown]) => {
      setLifetime(stats);
      setTop(breakdown);
    });
  }, [session?.user.id]);

  // Views / messages / items sold are each queried fresh for the selected
  // window — nothing here is a client-side guess against a lifetime total.
  useEffect(() => {
    if (!session) return;
    const since = new Date(Date.now() - (range === 'weekly' ? 7 : 30) * 24 * 60 * 60 * 1000);
    Promise.all([
      getListingViewsSince(session.user.id, since),
      getMessagesReceivedSince(session.user.id, since),
      getItemsSoldSince(session.user.id, since),
    ]).then(([views, messages, sold]) => setWindowed({ views, messages, sold }));
  }, [session?.user.id, range]);

  const metrics = [
    { label: 'Total views', value: String(windowed.views) },
    { label: 'Messages', value: String(windowed.messages) },
    { label: 'Items sold', value: String(windowed.sold) },
    { label: 'Followers', value: String(lifetime.followers) },
    { label: 'Listings', value: String(lifetime.listingsCount) },
    { label: 'Top category', value: top.topCategory?.label ?? '—' },
    { label: 'Top city', value: top.topCity?.label ?? '—' },
  ];

  if (!authed) return <Screen />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Analytics
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md }}>
        {(['weekly', 'monthly'] as const).map((r) => (
          <Pressable
            key={r}
            onPress={() => setRange(r)}
            style={{
              paddingHorizontal: spacing.sm,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: range === r ? colors.primary : colors.surface,
            }}
          >
            <Text variant="caption" color={range === r ? 'inverse' : 'secondary'} style={{ textTransform: 'capitalize' }}>
              {r}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text variant="caption" color="muted" style={{ marginBottom: spacing.sm }}>
        Views, messages and items sold reflect the last {range === 'weekly' ? '7 days' : '30 days'}. Followers, listings and top category/city are lifetime totals.
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {metrics.map((m) => (
          <Card key={m.label} style={{ width: '47%' }}>
            <Text variant="h2" color="brand">
              {m.value}
            </Text>
            <Text variant="caption" color="secondary">
              {m.label}
            </Text>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
