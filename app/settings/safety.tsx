import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { useTheme } from '@/theme/ThemeContext';

const TIP_KEYS = ['meetPublic', 'inspectFirst', 'neverPayAdvance', 'lookForBadges', 'reportSuspicious'] as const;
const TIP_ICONS: Record<(typeof TIP_KEYS)[number], keyof typeof Ionicons.glyphMap> = {
  meetPublic: 'people-outline',
  inspectFirst: 'eye-outline',
  neverPayAdvance: 'cash-outline',
  lookForBadges: 'shield-checkmark-outline',
  reportSuspicious: 'flag-outline',
};

export default function SafetyCenter() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('settings.safety.title')}
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        {TIP_KEYS.map((key) => (
          <Card key={key} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <Ionicons name={TIP_ICONS[key]} size={20} color={colors.success} />
            <View style={{ flex: 1, marginLeft: spacing.sm }}>
              <Text variant="bodyMedium">{t(`settings.safety.tips.${key}.title`)}</Text>
              <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
                {t(`settings.safety.tips.${key}.body`)}
              </Text>
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
