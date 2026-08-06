import { Pressable } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from '@/components/Text';

export function DevChip({ label, active, disabled, onPress }: { label: string; active?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors, spacing, radius } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      style={{
        paddingHorizontal: spacing.sm,
        paddingVertical: 8,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? colors.primary + '1A' : colors.background,
        opacity: disabled ? 0.4 : 1,
        marginRight: spacing.xs,
        marginBottom: spacing.xs,
      }}
    >
      <Text variant="caption" color={active ? 'brand' : 'secondary'}>
        {label}
      </Text>
    </Pressable>
  );
}
