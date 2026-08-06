import React from 'react';
import { Text as RNText, TextProps, TextStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';

type Variant = 'display' | 'h1' | 'h2' | 'h3' | 'bodyLg' | 'body' | 'bodyMedium' | 'caption' | 'tiny';
type Color = 'primary' | 'secondary' | 'muted' | 'accent' | 'brand' | 'inverse' | 'error' | 'success';

type Props = TextProps & {
  variant?: Variant;
  color?: Color;
  align?: TextStyle['textAlign'];
};

export function Text({ variant = 'body', color = 'primary', align, style, ...rest }: Props) {
  const { colors, type } = useTheme();
  const scale = type[variant];

  const colorMap: Record<Color, string> = {
    primary: colors.textPrimary,
    secondary: colors.textSecondary,
    muted: colors.textMuted,
    accent: colors.accent,
    brand: colors.primary,
    inverse: colors.primaryText,
    error: colors.error,
    success: colors.success,
  };

  return (
    <RNText
      style={[
        {
          fontSize: scale.size,
          lineHeight: scale.lineHeight,
          fontWeight: scale.weight,
          color: colorMap[color],
          textAlign: align,
        },
        style,
      ]}
      {...rest}
    />
  );
}
