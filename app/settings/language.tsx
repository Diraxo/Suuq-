import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';
import { useLanguageStore } from '@/store/language';
import { SUPPORTED_LOCALES, LANGUAGE_NAMES, AppLocale } from '@/lib/i18n';

// Language names are each language's own native name and must never be
// translated (CLAUDE.md i18n spec §5/§10/§11) — do not route these through t().
const LANGUAGES = SUPPORTED_LOCALES.map((code) => ({ code, label: LANGUAGE_NAMES[code] }));

export default function Language() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const lang = useLanguageStore((s) => s.locale);
  const setLocale = useLanguageStore((s) => s.setLocale);

  const selectLanguage = (code: AppLocale) => {
    setLocale(code);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('settings.language')}
        </Text>
      </View>

      <View style={{ gap: spacing.xs }}>
        {LANGUAGES.map((l) => (
          <Pressable
            key={l.code}
            onPress={() => selectLanguage(l.code)}
            accessibilityRole="radio"
            accessibilityState={{ selected: lang === l.code }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: spacing.md,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: lang === l.code ? colors.primary : colors.border,
              backgroundColor: lang === l.code ? colors.primary + '0D' : colors.surface,
            }}
          >
            <Text variant="body" color={lang === l.code ? 'brand' : 'primary'} style={{ flex: 1 }}>
              {l.label}
            </Text>
            {lang === l.code && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
