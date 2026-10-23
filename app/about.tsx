import { View, Pressable } from 'react-native';
import { openExternal } from '@/lib/openLink';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';

export default function About() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  const rows: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }[] = [
    { icon: 'lock-closed-outline', label: t('about.privacyPolicy'), onPress: () => router.push('/settings/privacy-policy') },
    { icon: 'document-text-outline', label: t('about.termsAndConditions'), onPress: () => router.push('/settings/terms') },
    { icon: 'mail-outline', label: t('about.contactSupport'), onPress: () => openExternal('mailto:suuqiyesupport@gmail.com') },
  ];

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.lg }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('about.title', { brand: 'SUUQIYE' })}
        </Text>
      </View>

      <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
        <Image
          source={require('@/assets/images/fursad-logo.png')}
          style={{ width: 72, height: 72, borderRadius: 20 }}
          contentFit="contain"
          cachePolicy="memory-disk"
          accessibilityLabel="SUUQIYE"
        />
        <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
          {t('about.version', { version: Constants.expoConfig?.version ?? t('about.unknownVersion') })}
        </Text>
      </View>

      <Text variant="body" color="secondary" style={{ marginBottom: spacing.lg }}>
        {t('about.description', { brand: 'SUUQIYE' })}
      </Text>

      <View style={{ gap: 2 }}>
        {rows.map((row) => (
          <Pressable key={row.label} onPress={row.onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm }}>
            <Ionicons name={row.icon} size={20} color={colors.textSecondary} />
            <Text variant="body" style={{ marginLeft: spacing.sm, flex: 1 }}>
              {row.label}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
