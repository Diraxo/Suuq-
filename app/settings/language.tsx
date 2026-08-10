import { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'so', label: 'Somali' },
  { code: 'am', label: 'አማርኛ' },
];

const LANGUAGE_STORAGE_KEY = '@suuq/language';

export default function Language() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const [lang, setLang] = useState('en');

  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then((stored) => {
      if (stored && LANGUAGES.some((l) => l.code === stored)) setLang(stored);
    });
  }, []);

  const selectLanguage = (code: string) => {
    setLang(code);
    AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, code).catch(() => {});
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Language
        </Text>
      </View>

      <View style={{ gap: spacing.xs }}>
        {LANGUAGES.map((l) => (
          <Pressable
            key={l.code}
            onPress={() => selectLanguage(l.code)}
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
