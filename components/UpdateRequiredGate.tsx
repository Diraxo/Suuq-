import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Modal, Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { pickMessage, resolveStoreUrl } from '@/lib/appUpdate';
import { installedVersion, retryAppUpdateCheck, updatePlatform, useAppUpdateStatus } from '@/store/appUpdate';

// Brand indigo, the same field as the splash (app/index.tsx), shown while a first-ever launch waits for the update policy.
const HOLD_BG = '#4F46E5';

/**
 * Full-screen, non-dismissible update screen. Mounted once in the root layout above every route, so sign-in, deep links and
 * notification taps (which all navigate beneath it) cannot reach normal screens while an update is required.
 * It is a native Modal so it also covers any modal a screen already has open; hardware back is swallowed on Android.
 */
export function UpdateRequiredGate() {
  const { t, i18n } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const status = useAppUpdateStatus();
  const pathname = usePathname();
  const [openFailed, setOpenFailed] = useState(false);
  const required = status.decision.kind === 'required';

  useEffect(() => {
    if (!required) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [required]);

  // First-ever launch with no cached policy: hold the app (up to the controller's time limit) instead of flashing normal screens.
  // On a normal launch the animated splash (app/index.tsx) is already on screen and waits for the policy itself.
  if (status.phase === 'checking') {
    if (pathname === '/') return null;
    return (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: HOLD_BG, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={t('appUpdate.checking')}>
        <ActivityIndicator color="#FFFFFF" />
      </View>
    );
  }
  if (status.decision.kind !== 'required') return null;

  const { storeUrl, message } = status.decision;
  const custom = pickMessage(message, i18n.language);
  const platform = updatePlatform ?? 'android';

  const onUpdate = async () => {
    setOpenFailed(false);
    try {
      await Linking.openURL(resolveStoreUrl(platform, storeUrl));
    } catch {
      setOpenFailed(true);
    }
  };

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }} accessibilityViewIsModal>
        <View style={{ width: 88, height: 88, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="cloud-download-outline" size={44} color={colors.primaryText} />
        </View>
        <Text variant="h2" align="center" style={{ marginTop: spacing.lg }} accessibilityRole="header">
          {t('appUpdate.title')}
        </Text>
        <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.sm, maxWidth: 420 }}>
          {custom ?? t('appUpdate.body')}
        </Text>
        <View style={{ marginTop: spacing.xl, width: '100%', maxWidth: 420 }}>
          <Button label={t('appUpdate.cta')} size="lg" fullWidth onPress={() => void onUpdate()} icon={<Ionicons name={Platform.OS === 'ios' ? 'logo-apple-appstore' : 'logo-google-playstore'} size={20} color={colors.primaryText} />} />
        </View>
        {openFailed ? (
          <Text variant="caption" color="error" align="center" style={{ marginTop: spacing.md }} accessibilityRole="alert">
            {t('appUpdate.openFailed')}
          </Text>
        ) : null}
        {status.lastFetchFailed ? (
          <View style={{ marginTop: spacing.md, alignItems: 'center' }}>
            <Text variant="caption" color="muted" align="center">{t('appUpdate.offline')}</Text>
            <Button label={t('appUpdate.retry')} variant="ghost" size="sm" onPress={retryAppUpdateCheck} />
          </View>
        ) : null}
        <Text variant="caption" color="muted" align="center" style={{ marginTop: spacing.lg }}>
          {t('appUpdate.version', { version: installedVersion() ?? '?' })}
        </Text>
      </View>
    </Modal>
  );
}
