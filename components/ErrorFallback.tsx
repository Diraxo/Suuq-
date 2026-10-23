import React, { useEffect } from 'react';
import { View, Pressable, Text as RNText, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as SplashScreen from 'expo-splash-screen';
import { lightColors, darkColors } from '@/theme/colors';
import { spacing, radius } from '@/theme/tokens';
import { logError } from '@/lib/errors';

// The screen shown when a render error escapes a route. It is exported by app/_layout.tsx and by individual routes as expo-router's
// `ErrorBoundary`, so it can be what the root renders: it therefore must not need ThemeProvider (or any store) to work, and it
// shows no error text at all, only a translated line and a retry button. The real error goes to logError.
export function ErrorFallback({ error, retry }: { error: Error; retry: () => Promise<void> | void }) {
  const { t } = useTranslation();
  const colors = useColorScheme() === 'dark' ? darkColors : lightColors;

  useEffect(() => {
    logError('render', error);
    // A render error before app/index.tsx mounts would otherwise hide the error screen behind the native splash.
    SplashScreen.hideAsync().catch(() => {});
  }, [error]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.background }} accessibilityRole="alert">
      <Ionicons name="alert-circle-outline" size={44} color={colors.error} />
      <RNText style={{ marginTop: spacing.md, fontSize: 20, fontWeight: '700', textAlign: 'center', color: colors.textPrimary }}>{t('common.somethingWentWrong')}</RNText>
      <RNText style={{ marginTop: spacing.xs, fontSize: 15, textAlign: 'center', color: colors.textSecondary }}>{t('errors.crash.message')}</RNText>
      <Pressable
        onPress={() => void retry()}
        accessibilityRole="button"
        accessibilityLabel={t('common.retry')}
        style={{ marginTop: spacing.lg, minWidth: 160, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: spacing.lg }}
      >
        <RNText style={{ color: colors.primaryText, fontSize: 16, fontWeight: '600' }}>{t('common.retry')}</RNText>
      </Pressable>
    </View>
  );
}
