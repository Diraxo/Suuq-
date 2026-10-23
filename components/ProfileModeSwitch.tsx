import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';

// Personal | Business switch shown on top of both profile editors. One account, two profiles: this only changes which one is being edited.
export function ProfileModeSwitch({ active }: { active: 'personal' | 'business' }) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const go = (mode: 'personal' | 'business') => {
    if (mode === active) return;
    router.replace((mode === 'personal' ? '/settings/edit-profile' : '/settings/business-profile') as any);
  };

  return (
    <View
      accessibilityLabel={t('settings.profileMode.label')}
      style={{ flexDirection: 'row', backgroundColor: colors.inputBackground, borderRadius: radius.md, padding: 3, marginBottom: spacing.md }}
    >
      {(['personal', 'business'] as const).map((mode) => {
        const on = mode === active;
        return (
          <Pressable
            key={mode}
            onPress={() => go(mode)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.xs, borderRadius: radius.md - 2, backgroundColor: on ? colors.primary : 'transparent' }}
          >
            <Text variant="bodyMedium" style={{ color: on ? colors.primaryText : colors.textSecondary }}>
              {t(`settings.profileMode.${mode}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
