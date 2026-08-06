import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { useTheme } from '@/theme/ThemeContext';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';

const ACTIONS: { icon: keyof typeof Ionicons.glyphMap; label: string; href: string }[] = [
  { icon: 'cloud-upload-outline', label: 'Bulk upload listings', href: '/business/bulk-upload' },
  { icon: 'bar-chart-outline', label: 'Analytics', href: '/business/analytics' },
  { icon: 'storefront-outline', label: 'Edit storefront', href: '/settings' },
];

export default function BusinessDashboard() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();

  if (!authed) return <Screen />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Business Dashboard
        </Text>
      </View>

      <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
        {ACTIONS.map((a) => (
          <Pressable key={a.label} onPress={() => router.push(a.href as any)}>
            <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name={a.icon} size={20} color={colors.primary} />
              <Text variant="bodyMedium" style={{ marginLeft: spacing.sm, flex: 1 }}>
                {a.label}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Card>
          </Pressable>
        ))}
      </View>

      <Card elevated={false} style={{ opacity: 0.6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
          <Text variant="bodyMedium" style={{ flex: 1 }}>
            Subscription plans
          </Text>
          <Badge label="Coming later" tone="neutral" />
        </View>
        <Text variant="caption" color="secondary">
          Featured placement and dealer subscriptions are disabled for year one — the app stays free while we focus on growth and trust.
        </Text>
      </Card>
    </Screen>
  );
}
