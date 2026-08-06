import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';

type Props = {
  children: React.ReactNode;
  style?: ViewStyle;
  elevated?: boolean;
  padded?: boolean;
};

export function Card({ children, style, elevated = true, padded = true }: Props) {
  const { colors, radius, spacing, shadow } = useTheme();

  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          padding: padded ? spacing.md : 0,
          borderWidth: elevated ? 0 : 1,
          borderColor: colors.border,
        },
        elevated ? shadow.sm : undefined,
        style,
      ]}
    >
      {children}
    </View>
  );
}
