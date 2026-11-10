import { Pressable, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';

type Props = {
  visible: boolean;
  title: string;
  galleryLabel: string;
  cameraLabel: string;
  cancelLabel: string;
  onGallery: () => void;
  onCamera: () => void;
  onCancel: () => void;
};

// Styled replacement for the plain "choose from gallery / take photo / cancel" alert.
// Deliberately a plain overlay View, not a native Modal: it lives inside the Sell screen,
// so the camera / photo picker can open immediately with nothing still dismissing.
export function PhotoSourceSheet({ visible, title, galleryLabel, cameraLabel, cancelLabel, onGallery, onCamera, onCancel }: Props) {
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  const row = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 60,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.border : colors.background,
      })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm }}>
        <Ionicons name={icon} size={22} color={colors.primaryText} />
      </View>
      <Text variant="bodyLg" style={{ flex: 1, fontWeight: '600' }}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );

  return (
    <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end', backgroundColor: colors.overlay, zIndex: 50, elevation: 50 }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityRole="button" accessibilityLabel={cancelLabel} />
      <View
        style={{
          backgroundColor: colors.surfaceElevated,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          paddingTop: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingBottom: Math.max(insets.bottom, spacing.md),
          gap: spacing.xs,
        }}
      >
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.xs }} />
        <Text variant="h3" align="center" style={{ marginBottom: spacing.xs }}>
          {title}
        </Text>
        {row('images', galleryLabel, onGallery)}
        {row('camera', cameraLabel, onCamera)}
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          style={({ pressed }) => ({
            minHeight: 52,
            marginTop: spacing.xs,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.md,
            backgroundColor: colors.error,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text variant="bodyLg" style={{ color: '#fff', fontWeight: '600' }}>
            {cancelLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
