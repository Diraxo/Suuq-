import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';

const OPTIONS: { value: 'light' | 'dark' | 'system'; labelKey: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'light', labelKey: 'settings.appearance.light', icon: 'sunny-outline' },
  { value: 'dark', labelKey: 'settings.appearance.dark', icon: 'moon-outline' },
  { value: 'system', labelKey: 'settings.appearance.matchSystem', icon: 'phone-portrait-outline' },
];

export default function Appearance() {
  const { colors, spacing, radius, mode, setMode } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('settings.appearance.title')}
        </Text>
      </View>

      <View style={{ gap: spacing.xs }}>
        {OPTIONS.map((opt) => {
          const active = mode === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setMode(opt.value)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primary + '0D' : colors.surface,
              }}
            >
              <Ionicons name={opt.icon} size={20} color={active ? colors.primary : colors.textSecondary} />
              <Text variant="body" color={active ? 'brand' : 'primary'} style={{ marginLeft: spacing.sm, flex: 1 }}>
                {t(opt.labelKey)}
              </Text>
              {active && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
