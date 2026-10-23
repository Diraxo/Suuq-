import { useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';
import { useActiveMode } from '@/hooks/useActiveMode';
import { showSnackbar } from '@/lib/snackbar';
import { ProfileMode } from '@/lib/profileIdentity';

// Chooses which identity the world sees for this one account. Unlike ProfileModeSwitch (which only picks an editor), this writes
// profiles.active_mode, so other people's screens change too.
export function ActiveIdentitySwitch() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const { mode, canUseBusiness, busy, switchTo } = useActiveMode();
  const [pending, setPending] = useState<ProfileMode | null>(null);

  const choose = async (next: ProfileMode) => {
    if (busy || next === mode) return;
    if (next === 'business' && !canUseBusiness) return;
    setPending(next);
  };

  const runPending = async () => {
    const next = pending;
    setPending(null);
    if (!next) return;
    const result = await switchTo(next);
    if (result.ok) return;
    showSnackbar(t(result.reason === 'unavailable' ? 'business.identity.unavailable' : 'business.identity.failed'));
  };

  const pendingLabel = pending ? t(`business.identity.${pending}`).toLowerCase() : '';

  return (
    <View style={{ marginTop: spacing.md }}>
      <ConfirmDialog
        visible={pending !== null}
        icon={pending === 'business' ? 'storefront-outline' : 'person-outline'}
        title={t('business.identity.confirmTitle', { mode: pendingLabel })}
        message={t('business.identity.confirmBody', { mode: pendingLabel })}
        confirmLabel={t('business.identity.confirmYes')}
        cancelLabel={t('business.identity.confirmNo')}
        onCancel={() => setPending(null)}
        onConfirm={runPending}
      />
      <View accessibilityRole="tablist" accessibilityLabel={t('business.identity.label')} style={{ flexDirection: 'row', backgroundColor: colors.inputBackground, borderRadius: radius.pill, padding: 4 }}>
        {(['personal', 'business'] as const).map((m) => {
          const on = m === mode;
          return (
            <Pressable
              key={m}
              onPress={() => choose(m)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on, busy }}
              style={{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: radius.pill, backgroundColor: on ? colors.primary : 'transparent' }}
            >
              <Ionicons name={m === 'personal' ? 'person' : 'storefront'} size={15} color={on ? colors.primaryText : colors.textSecondary} />
              <Text variant="bodyMedium" style={{ color: on ? colors.primaryText : colors.textSecondary }}>
                {t(`business.identity.${m}`)}
              </Text>
              {busy && on ? <ActivityIndicator size="small" color={colors.primaryText} /> : null}
            </Pressable>
          );
        })}
      </View>
      <Text variant="tiny" color="muted" style={{ textAlign: 'center', marginTop: 6 }}>
        {t('business.identity.viewing', { mode: t(`business.identity.${mode}`).toLowerCase() })}
      </Text>
    </View>
  );
}
