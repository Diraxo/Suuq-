import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Modal, Platform, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { openLink, UpdateLogo, VersionRow } from '@/components/UpdateParts';
import { useTheme } from '@/theme/ThemeContext';
import { localizeRelease, pickMessage, resolveStoreUrl } from '@/lib/appUpdate';
import { installedVersion, retryAppUpdateCheck, updatePlatform, useAppUpdateStatus } from '@/store/appUpdate';

// Brand indigo, the same field as the splash (app/index.tsx), shown while a first-ever launch waits for the update policy.
const HOLD_BG = '#4F46E5';

/**
 * Full-screen, non-dismissible update screen (critical / mandatory release). Mounted once in the root layout above every route, so
 * sign-in, deep links and notification taps (which all navigate beneath it) cannot reach normal screens while an update is required.
 * It is a native Modal so it also covers any modal a screen already has open; hardware back is swallowed on Android, and there is no
 * close, "later" or swipe affordance. iOS uses a full-screen presentation, which has no swipe-down dismissal.
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

  const { storeUrl, message, release, minimumVersion, targetVersion, supportUrl } = status.decision;
  const localized = release ? localizeRelease(release, i18n.language) : null;
  const reason = localized?.description ?? pickMessage(message, i18n.language) ?? t('appUpdate.body');
  const platform = updatePlatform ?? 'android';

  const onUpdate = async () => {
    setOpenFailed(false);
    setOpenFailed(!(await openLink(resolveStoreUrl(platform, storeUrl))));
  };

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={() => {}}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}
        accessibilityViewIsModal
      >
        <View style={{ width: '100%', maxWidth: 420, alignItems: 'center' }}>
          <View>
            <UpdateLogo size={72} />
            <View style={{ position: 'absolute', right: -10, bottom: -10, width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.warning, borderWidth: 3, borderColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="warning" size={18} color="#FFFFFF" />
            </View>
          </View>
          <Text variant="h2" align="center" style={{ marginTop: spacing.lg }} accessibilityRole="header">
            {t('appUpdate.title')}
          </Text>
          {localized ? (
            <Text variant="bodyLg" align="center" style={{ marginTop: spacing.xs, fontWeight: '700' }}>{localized.title}</Text>
          ) : null}
          <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.sm }}>{reason}</Text>

          <View style={{ width: '100%', marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
            <Text variant="caption" color="muted" style={{ marginBottom: 2 }}>{t('appUpdate.required.why')}</Text>
            <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>{t('appUpdate.required.securityNote')}</Text>
            <VersionRow label={t('appUpdate.required.installed')} value={installedVersion() ?? '?'} />
            <VersionRow label={t('appUpdate.required.minimum')} value={minimumVersion} />
            <VersionRow label={t('appUpdate.required.target')} value={targetVersion} emphasis />
          </View>

          <View style={{ marginTop: spacing.xl, width: '100%' }}>
            <Button label={t('appUpdate.cta')} size="lg" fullWidth onPress={() => void onUpdate()} icon={<Ionicons name={Platform.OS === 'ios' ? 'logo-apple-appstore' : 'logo-google-playstore'} size={20} color={colors.primaryText} />} />
          </View>
          {openFailed ? (
            <Text variant="caption" color="error" align="center" style={{ marginTop: spacing.md }} accessibilityRole="alert">
              {t('appUpdate.openFailed')}
            </Text>
          ) : null}
          {openFailed || status.lastFetchFailed ? (
            <View style={{ marginTop: spacing.sm, alignItems: 'center' }}>
              {status.lastFetchFailed ? <Text variant="caption" color="muted" align="center">{t('appUpdate.offline')}</Text> : null}
              <Button label={t('appUpdate.required.checkAgain')} variant="ghost" size="sm" onPress={retryAppUpdateCheck} />
            </View>
          ) : null}
          {supportUrl ? (
            <Button label={t('appUpdate.required.support')} variant="ghost" size="sm" onPress={() => void openLink(supportUrl)} icon={<Ionicons name="help-buoy-outline" size={18} color={colors.primary} />} />
          ) : null}
        </View>
      </ScrollView>
    </Modal>
  );
}
