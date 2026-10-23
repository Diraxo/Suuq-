import { View, Pressable } from 'react-native';
import { openExternal } from '@/lib/openLink';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { useTheme } from '@/theme/ThemeContext';

const FAQ_KEYS = ['postListing', 'freeToUse', 'staySafe', 'reportScam'] as const;

export default function Help() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('help.title')}
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        {FAQ_KEYS.map((key) => (
          <Card key={key}>
            <Text variant="bodyMedium">{t(`help.faq.${key}.question`)}</Text>
            <Text variant="caption" color="secondary" style={{ marginTop: 4 }}>
              {t(`help.faq.${key}.answer`, { brand: 'SUUQIYE' })}
            </Text>
          </Card>
        ))}
      </View>

      <Pressable
        onPress={() => openExternal('mailto:suuqiyesupport@gmail.com')}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface }}
      >
        <Ionicons name="mail-outline" size={18} color={colors.primary} />
        <Text variant="bodyMedium" color="brand" style={{ marginLeft: spacing.xs }}>
          {t('help.contactSupport')}
        </Text>
      </Pressable>
    </Screen>
  );
}
