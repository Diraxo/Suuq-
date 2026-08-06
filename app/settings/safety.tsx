import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { useTheme } from '@/theme/ThemeContext';

const TIPS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { icon: 'people-outline', title: 'Meet in a public place', body: 'Choose a busy, well-lit spot — a market, mall, or police station forecourt works well.' },
  { icon: 'eye-outline', title: 'Inspect before you pay', body: 'Check the item works as described before handing over any cash.' },
  { icon: 'cash-outline', title: 'Never send money in advance', body: "Legitimate sellers won't ask you to pay before you've seen the item." },
  { icon: 'shield-checkmark-outline', title: 'Look for verification badges', body: 'Verified and Trusted Seller badges mean extra checks have been completed.' },
  { icon: 'flag-outline', title: 'Report anything suspicious', body: 'Use the Report button on any listing or profile — our team reviews every report.' },
];

export default function SafetyCenter() {
  const { colors, spacing } = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Safety Center
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        {TIPS.map((t) => (
          <Card key={t.title} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <Ionicons name={t.icon} size={20} color={colors.success} />
            <View style={{ flex: 1, marginLeft: spacing.sm }}>
              <Text variant="bodyMedium">{t.title}</Text>
              <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
                {t.body}
              </Text>
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
