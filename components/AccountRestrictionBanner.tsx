import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { useModerationStore } from '@/store/moderation';
import { effectiveAccountState } from '@/lib/moderationClient';

// Shown to a suspended or banned seller. The state comes from the database (kept live over Realtime); the end
// date is re-evaluated locally every 30s so the banner disappears by itself when a suspension ends. The server
// enforces the restriction regardless of what this banner shows.
export function AccountRestrictionBanner() {
  const { colors, spacing, radius } = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const account = useModerationStore((s) => s.account);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const state = effectiveAccountState({ account_status: account.status, suspended_until: account.until }, now);
  if (state.status === 'active') return null;

  const message =
    state.status === 'banned'
      ? t('support.banner.banned')
      : state.until
        ? t('support.banner.suspended', { date: new Date(state.until).toLocaleString(i18n.language) })
        : t('support.banner.suspendedNoDate');

  return (
    <Pressable
      onPress={() => router.push('/support' as never)}
      accessibilityRole="alert"
      accessibilityLabel={message}
      style={{ flexDirection: 'row', alignItems: 'flex-start', padding: spacing.sm, marginBottom: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warning + '1A' }}
    >
      <Ionicons name="alert-circle" size={18} color={colors.warning} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, marginLeft: spacing.xs }}>
        <Text variant="caption">{message}</Text>
        <Text variant="caption" color="brand" style={{ marginTop: 2 }}>
          {t('support.banner.details')}
        </Text>
      </View>
    </Pressable>
  );
}
