import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';

type Tone = 'brand' | 'success' | 'warning' | 'neutral' | 'accent' | 'solid';

type Props = {
  label: string;
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
};

export function Badge({ label, tone = 'neutral', icon }: Props) {
  const { colors, radius, spacing, shadow } = useTheme();

  // "solid" is an opaque, high-contrast badge meant to sit on top of a photo
  // (e.g. the Sold badge on a listing thumbnail) — the tinted tones above are
  // designed for solid card backgrounds and nearly disappear over an image.
  // Red (colors.error) reads as an unambiguous "no longer available" marker
  // in a marketplace, the same convention shoppers already know.
  const backgrounds: Record<Tone, string> = {
    brand: colors.primary + '1A',
    success: colors.success + '1A',
    warning: colors.warning + '1A',
    accent: colors.accent + '1A',
    neutral: colors.border,
    solid: colors.error,
  };
  const textColors: Record<Tone, string> = {
    brand: colors.primary,
    success: colors.success,
    warning: colors.warning,
    accent: colors.accent,
    neutral: colors.textSecondary,
    solid: '#FFFFFF',
  };

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          backgroundColor: backgrounds[tone],
          borderRadius: radius.pill,
          paddingHorizontal: spacing.xs,
          paddingVertical: 4,
        },
        tone === 'solid' && shadow.sm,
      ]}
    >
      {icon && <Ionicons name={icon} size={12} color={textColors[tone]} style={{ marginRight: 4 }} />}
      <Text variant="tiny" style={{ color: textColors[tone], fontWeight: tone === 'solid' ? '700' : undefined }}>
        {label}
      </Text>
    </View>
  );
}
