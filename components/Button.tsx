import React from 'react';
import { Pressable, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  fullWidth,
  icon,
  style,
}: Props) {
  const { colors, radius, spacing } = useTheme();

  const heights = { sm: 40, md: 50, lg: 58 };
  const paddingX = { sm: spacing.md, md: spacing.lg, lg: spacing.xl };

  const backgrounds: Record<Variant, string> = {
    primary: colors.primary,
    secondary: colors.accent,
    outline: 'transparent',
    ghost: 'transparent',
    danger: colors.error,
  };

  const textColors: Record<Variant, 'inverse' | 'brand' | 'primary'> = {
    primary: 'inverse',
    secondary: 'inverse',
    outline: 'brand',
    ghost: 'brand',
    danger: 'inverse',
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading }}
      style={({ pressed }) => [
        styles.base,
        {
          height: heights[size],
          paddingHorizontal: paddingX[size],
          backgroundColor: backgrounds[variant],
          borderRadius: radius.pill,
          borderWidth: variant === 'outline' ? 1.5 : 0,
          borderColor: colors.primary,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          width: fullWidth ? '100%' : undefined,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'outline' || variant === 'ghost' ? colors.primary : colors.primaryText} />
      ) : (
        <>
          {icon}
          <Text variant="bodyMedium" color={textColors[variant]} style={icon ? { marginLeft: 8 } : undefined}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
