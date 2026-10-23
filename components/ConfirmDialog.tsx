import { Modal, View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

// Themed replacement for Alert.alert confirmations so prompts follow the app's light/dark mode.
export function ConfirmDialog({ visible, title, message, confirmLabel, cancelLabel, icon = 'help-circle-outline', destructive, loading = false, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const { colors, spacing, radius, shadow } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={loading ? undefined : onCancel}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay, padding: spacing.xl }}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={loading ? undefined : onCancel}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
        />
        <View
          style={[
            {
              width: '100%',
              maxWidth: 340,
              backgroundColor: colors.surfaceElevated,
              borderRadius: radius.lg,
              padding: spacing.lg,
              alignItems: 'center',
            },
            shadow.md,
          ]}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: colors.background,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: spacing.md,
            }}
          >
            <Ionicons name={icon} size={24} color={destructive ? colors.error : colors.primary} />
          </View>

          <Text variant="h3" align="center">
            {title}
          </Text>
          <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs }}>
            {message}
          </Text>

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignSelf: 'stretch' }}>
            <Button label={cancelLabel ?? t('common.cancel')} variant="outline" onPress={onCancel} disabled={loading} style={{ flex: 1 }} />
            <Button label={confirmLabel} variant={destructive ? 'danger' : 'primary'} onPress={onConfirm} loading={loading} disabled={loading} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
