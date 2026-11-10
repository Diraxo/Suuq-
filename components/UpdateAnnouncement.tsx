import React, { useEffect, useState } from 'react';
import { Modal, Platform, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { BRAND_BG, openLink, UpdateLogo, VersionRow, WhatsNewList } from '@/components/UpdateParts';
import { useTheme } from '@/theme/ThemeContext';
import { localizeRelease, OptionalUpdate, resolveStoreUrl } from '@/lib/appUpdate';
import { dismissUpdateReminder, installedVersion, shouldShowUpdateReminder, updatePlatform, useAppUpdateStatus } from '@/store/appUpdate';

/**
 * The dismissible update prompt: a compact reminder for a normal release, a prominent announcement for an important one.
 * Shown at most once per app session (the reminder store enforces it, so navigation never re-triggers it) and again only after the
 * configured interval. A mandatory update never reaches this component: the gate (UpdateRequiredGate) covers that case.
 * Mounted once in the root layout; held back while the splash is up.
 */
export function UpdateAnnouncement() {
  const { t, i18n } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const status = useAppUpdateStatus();
  const pathname = usePathname();
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState(false);

  const update: OptionalUpdate | null = status.phase === 'ready' && status.decision.kind === 'optional' ? status.decision : null;
  const key = update ? `${update.release?.id ?? 'recommended'}:${update.targetVersion}` : null;
  const afterSplash = pathname !== '/';

  // Evaluate once per update (and again only if a newer one arrives). Deliberately not tied to the pathname beyond "splash is over".
  useEffect(() => {
    if (!update || !key || !afterSplash) return;
    void shouldShowUpdateReminder(update).then((show) => {
      if (show) setShownKey(key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, afterSplash]);

  if (!update || !key || shownKey !== key) return null;

  const important = update.tier === 'important';
  const localized = update.release ? localizeRelease(update.release, i18n.language) : null;
  const heading = t(important ? 'appUpdate.important.title' : 'appUpdate.normal.title');
  const body = localized?.description ?? t(important ? 'appUpdate.important.body' : 'appUpdate.normal.body');
  const showList = update.showWhatsNew && !!localized && localized.changelog.length > 0;
  const platform = updatePlatform ?? 'android';

  const later = () => {
    setShownKey(null);
    void dismissUpdateReminder(update);
  };
  const onUpdate = async () => {
    setOpenFailed(!(await openLink(resolveStoreUrl(platform, update.storeUrl))));
  };

  const versions = (
    <View style={{ width: '100%', marginTop: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <VersionRow label={t('appUpdate.required.installed')} value={installedVersion() ?? '?'} />
      <VersionRow label={t('appUpdate.newVersion')} value={update.targetVersion} emphasis />
    </View>
  );

  const actions = (
    <View style={{ width: '100%', marginTop: spacing.lg, gap: spacing.xs }}>
      <Button label={t('appUpdate.cta')} size="lg" fullWidth onPress={() => void onUpdate()} icon={<Ionicons name={Platform.OS === 'ios' ? 'logo-apple-appstore' : 'logo-google-playstore'} size={20} color={colors.primaryText} />} />
      <Button label={t('appUpdate.later')} variant="ghost" fullWidth onPress={later} />
      {openFailed ? (
        <Text variant="caption" color="error" align="center" accessibilityRole="alert">{t('appUpdate.openFailed')}</Text>
      ) : null}
    </View>
  );

  return (
    <Modal visible transparent animationType={important ? 'slide' : 'fade'} statusBarTranslucent onRequestClose={later}>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: important ? 'flex-end' : 'center', alignItems: 'center', padding: important ? 0 : spacing.xl }} accessibilityViewIsModal>
        {important ? (
          // Important feature release: tall sheet, brand header band, feature list with icons.
          <View style={{ width: '100%', maxWidth: 560, maxHeight: '90%', backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden' }}>
            <View style={{ backgroundColor: BRAND_BG, alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.lg, paddingHorizontal: spacing.xl }}>
              <View style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="rocket-outline" size={32} color="#FFFFFF" />
              </View>
              <Text variant="h2" align="center" style={{ color: '#FFFFFF', marginTop: spacing.sm }} accessibilityRole="header">{heading}</Text>
              {localized ? <Text variant="bodyLg" align="center" style={{ color: '#E0E7FF', marginTop: spacing.xxs }}>{localized.title}</Text> : null}
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing.xl + spacing.md }}>
              <Text variant="body" color="secondary">{body}</Text>
              {showList ? (
                <View style={{ marginTop: spacing.lg }}>
                  <Text variant="h3" style={{ marginBottom: spacing.sm }}>{t('appUpdate.whatsNew')}</Text>
                  <WhatsNewList items={localized!.changelog} withIcons />
                </View>
              ) : null}
              {versions}
              {actions}
            </ScrollView>
          </View>
        ) : (
          // Normal release: compact, quiet card.
          <View style={{ width: '100%', maxWidth: 400, maxHeight: '85%', backgroundColor: colors.background, borderRadius: radius.xl, padding: spacing.xl }}>
            <ScrollView contentContainerStyle={{ alignItems: 'center' }}>
              <UpdateLogo size={64} />
              <Text variant="h3" align="center" style={{ marginTop: spacing.md }} accessibilityRole="header">{heading}</Text>
              <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xs }}>{body}</Text>
              {showList ? (
                <View style={{ width: '100%', marginTop: spacing.md }}>
                  <Text variant="bodyMedium" style={{ marginBottom: spacing.xs }}>{t('appUpdate.whatsNew')}</Text>
                  <WhatsNewList items={localized!.changelog} withIcons={false} max={4} />
                </View>
              ) : null}
              {versions}
              {actions}
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
}
