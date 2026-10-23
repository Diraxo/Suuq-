import { useEffect, useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { getBusinessAnalytics, BusinessAnalytics as BusinessAnalyticsData } from '@/lib/sellerStats';
import { categoryLabel } from '@/data/categoryNames';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { Button } from '@/components/Button';

export default function BusinessAnalytics() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const authed = useRequireAuthScreen();
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id;
  const [range, setRange] = useState<'weekly' | 'monthly'>('weekly');
  const [data, setData] = useState<BusinessAnalyticsData | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Every number is queried fresh for the selected window; a failed query shows an error, never a made-up zero.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setData(null);
    setFailed(false);
    const since = new Date(Date.now() - (range === 'weekly' ? 7 : 30) * 24 * 60 * 60 * 1000);
    getBusinessAnalytics(userId, since)
      .then((next) => alive && setData(next))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [userId, range, attempt]);

  const metrics = data
    ? [
        { label: t('business.analytics.totalViews'), value: String(data.views) },
        { label: t('business.analytics.messages'), value: String(data.messages) },
        { label: t('business.analytics.itemsSold'), value: String(data.sold) },
        { label: t('business.analytics.followers'), value: String(data.followers) },
        { label: t('business.analytics.listings'), value: String(data.listings) },
        { label: t('business.analytics.topCategory'), value: data.topCategory ? categoryLabel(t, data.topCategory.label) : '—' },
        { label: t('business.analytics.topCity'), value: data.topCity?.label ?? '—' },
      ]
    : [];
  if (!authed) return <Screen />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('business.analytics.title')}
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
              {t(`business.analytics.range.${r}`)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text variant="caption" color="muted" style={{ marginBottom: spacing.sm }}>
        {t('business.analytics.summary', { days: range === 'weekly' ? 7 : 30 })}
      </Text>

      {failed && (
        <View style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg }}>
          <Text variant="body" color="secondary" align="center">{t('business.analytics.loadError')}</Text>
          <Button label={t('common.retry')} variant="outline" onPress={() => setAttempt((n) => n + 1)} />
        </View>
      )}
      {!failed && !data && <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />}

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

