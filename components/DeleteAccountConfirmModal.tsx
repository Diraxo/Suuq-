import { Modal, View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';

type Props = {
  visible: boolean;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteAccountConfirmModal({ visible, loading, onCancel, onConfirm }: Props) {
  const { colors, spacing, radius, shadow } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={loading ? undefined : onCancel}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay, padding: spacing.xl }}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={loading ? undefined : onCancel}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
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
              backgroundColor: colors.error + '1A',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: spacing.md,
            }}
          >
            <Ionicons name="warning-outline" size={24} color={colors.error} />
          </View>

          <Text variant="h3" align="center">
            Delete your account?
          </Text>
          <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs }}>
            This will permanently delete your account and the data associated with it. This action cannot be undone.
          </Text>

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignSelf: 'stretch' }}>
            <Button label="Cancel" variant="outline" onPress={onCancel} disabled={loading} style={{ flex: 1 }} />
            <Button label="Delete account" variant="danger" onPress={onConfirm} loading={loading} disabled={loading} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
