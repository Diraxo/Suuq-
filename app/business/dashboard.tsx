import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { useTheme } from '@/theme/ThemeContext';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';

const ACTIONS: { icon: keyof typeof Ionicons.glyphMap; labelKey: string; href: string }[] = [
  { icon: 'cloud-upload-outline', labelKey: 'business.dashboard.bulkUploadListings', href: '/business/bulk-upload' },
  { icon: 'bar-chart-outline', labelKey: 'business.dashboard.analytics', href: '/business/analytics' },
  { icon: 'storefront-outline', labelKey: 'business.dashboard.editStorefront', href: '/settings' },
];

export default function BusinessDashboard() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const authed = useRequireAuthScreen();

  if (!authed) return <Screen />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('business.dashboard.title')}
        </Text>
      </View>

      <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
        {ACTIONS.map((a) => (
          <Pressable key={a.labelKey} onPress={() => router.push(a.href as any)}>
            <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name={a.icon} size={20} color={colors.primary} />
              <Text variant="bodyMedium" style={{ marginLeft: spacing.sm, flex: 1 }}>
                {t(a.labelKey)}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Card>
          </Pressable>
        ))}
      </View>

      <Card elevated={false} style={{ opacity: 0.6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
          <Text variant="bodyMedium" style={{ flex: 1 }}>
            {t('business.dashboard.subscriptionPlans')}
          </Text>
          <Badge label={t('business.dashboard.comingLater')} tone="neutral" />
        </View>
        <Text variant="caption" color="secondary">
          {t('business.dashboard.subscriptionDescription')}
        </Text>
      </Card>
    </Screen>
  );
}
