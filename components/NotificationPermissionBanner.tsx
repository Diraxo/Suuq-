import { useEffect, useState } from 'react';
import { View, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { push, PermissionStatus } from '@/lib/push';
import { Text } from './Text';

// Contextual, non-blocking nudge for the OS notification permission — shown
// on Home for signed-in users instead of firing the system dialog on every
// app launch (see lib/push.ts register()). Throttled via
// shouldShowPermissionPrompt() so a "Not now" tap doesn't reappear for days.
export function NotificationPermissionBanner({ userId }: { userId: string }) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useTranslation();
  const [status, setStatus] = useState<PermissionStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    push.shouldShowPermissionPrompt(userId).then((result) => {
      if (!cancelled) setStatus(result);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!status) return null;
  const isDenied = status === 'denied';

  const dismiss = () => {
    push.dismissPermissionPrompt(userId);
    setStatus(null);
  };

  const handlePrimary = async () => {
    if (isDenied) {
      await Linking.openSettings();
    } else {
      await push.requestPermissionAndRegister(userId);
    }
    dismiss();
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        padding: spacing.md,
        marginTop: spacing.md,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: colors.primary + '1A',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="notifications-outline" size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text variant="bodyMedium">{t(isDenied ? 'push.prompt.deniedTitle' : 'push.prompt.title')}</Text>
        <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
          {t(isDenied ? 'push.prompt.deniedMessage' : 'push.prompt.message')}
        </Text>
        <View style={{ flexDirection: 'row', marginTop: spacing.sm, gap: spacing.lg }}>
          <Pressable onPress={handlePrimary} accessibilityRole="button">
            <Text variant="bodyMedium" color="brand">
              {t(isDenied ? 'push.prompt.turnOn' : 'push.prompt.allow')}
            </Text>
          </Pressable>
          <Pressable onPress={dismiss} accessibilityRole="button">
            <Text variant="bodyMedium" color="secondary">
              {t('push.prompt.notNow')}
            </Text>
          </Pressable>
        </View>
      </View>
      <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel={t('push.prompt.dismissA11y')} hitSlop={8}>
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}
