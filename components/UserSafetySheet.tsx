import { Modal, View, Pressable, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from '@/components/Text';
import { showSnackbar } from '@/lib/snackbar';
import { useBlockedUsersStore } from '@/store/blockedUsers';
import { useAuthStore } from '@/store/auth';

type Props = {
  visible: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
  /** Listing the conversation / card is about. When set, "Report this listing" is offered (a separate report category). */
  listingId?: string | null;
  /** Where the sheet was opened — tags the report so the review team knows the context. */
  source: 'chat' | 'listing' | 'profile';
  conversationId?: string;
  /** Hide "View profile" when the sheet is already on the profile. */
  hideViewProfile?: boolean;
};

/**
 * One safety menu for every place a person meets another: chat header, listing seller card and the profile page.
 * View profile · Report listing · Report user · Block / Unblock. Reports are filed through /report (listing and user are
 * different report categories); blocks go through the blocked-users store, and the database enforces them (0043/0044).
 */
export function UserSafetySheet({ visible, onClose, userId, userName, listingId, source, conversationId, hideViewProfile }: Props) {
  const { colors, spacing, radius, shadow } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const blocked = useBlockedUsersStore((s) => s.blocked);
  const blockedByMe = blocked.some((b) => b.id === userId);
  const meId = useAuthStore((s) => s.session?.user.id);
  // Defence in depth: nobody can block or report themselves, whatever screen opens this.
  if (meId && meId === userId) return null;

  const reportParams = (type: 'listing' | 'user', id: string) => {
    const q = new URLSearchParams({ type, id, source });
    if (conversationId) q.set('conversationId', conversationId);
    return `/report?${q.toString()}`;
  };

  const go = (path: string) => {
    onClose();
    router.push(path as any);
  };

  const confirmBlock = () => {
    onClose();
    Alert.alert(t('seller.blockConfirmTitle', { name: userName }), t('seller.blockConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.block'),
        style: 'destructive',
        onPress: async () => {
          await useBlockedUsersStore.getState().block(userId);
          showSnackbar(t('seller.blockedSnackbar', { name: userName }));
        },
      },
    ]);
  };

  const confirmUnblock = () => {
    onClose();
    Alert.alert(t('seller.unblockConfirmTitle', { name: userName }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.unblock'),
        onPress: async () => {
          await useBlockedUsersStore.getState().unblock(userId);
          showSnackbar(t('seller.unblockedSnackbar', { name: userName }));
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('chat.dismiss')} />
        <View
          style={[
            { backgroundColor: colors.surfaceElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: insets.bottom + spacing.md, paddingTop: spacing.md },
            shadow.md,
          ]}
        >
          <Text variant="bodyMedium" style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.xs }}>
            {t('safety.title')}
          </Text>
          {!hideViewProfile && <Row icon="person-circle-outline" label={t('safety.viewProfile')} onPress={() => go(`/seller/${userId}`)} />}
          {!!listingId && <Row icon="flag-outline" label={t('safety.reportListing')} onPress={() => go(reportParams('listing', listingId))} />}
          <Row icon="alert-circle-outline" label={t('safety.reportUser', { name: userName })} onPress={() => go(reportParams('user', userId))} />
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.xs }} />
          {blockedByMe ? (
            <Row icon="checkmark-circle-outline" label={t('safety.unblockUser', { name: userName })} onPress={confirmUnblock} />
          ) : (
            <Row icon="ban-outline" label={t('safety.blockUser', { name: userName })} hint={t('safety.blockHint')} tone="error" onPress={confirmBlock} />
          )}
        </View>
      </View>
    </Modal>
  );
}

function Row({ icon, label, hint, tone = 'default', onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; hint?: string; tone?: 'default' | 'error'; onPress: () => void }) {
  const { colors, spacing } = useTheme();
  const color = tone === 'error' ? colors.error : colors.textPrimary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, opacity: pressed ? 0.6 : 1 })}
    >
      <Ionicons name={icon} size={22} color={color} style={{ width: 30 }} />
      <View style={{ flex: 1, marginLeft: spacing.xs }}>
        <Text variant="body" style={{ color }}>
          {label}
        </Text>
        {!!hint && (
          <Text variant="tiny" color="muted">
            {hint}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
