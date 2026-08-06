import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { Button } from './Button';

type Props = {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

// An empty screen is an invitation to act, not a dead end — always pair
// the explanation with something the person can do next where possible.
export function EmptyState({ icon = 'search-outline', title, message, actionLabel, onAction }: Props) {
  const { colors, spacing } = useTheme();

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', padding: spacing.xxl }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: colors.inputBackground,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.md,
        }}
      >
        <Ionicons name={icon} size={30} color={colors.textMuted} />
      </View>
      <Text variant="h3" align="center">
        {title}
      </Text>
      {message && (
        <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs, marginBottom: spacing.lg }}>
          {message}
        </Text>
      )}
      {actionLabel && onAction && <Button label={actionLabel} onPress={onAction} />}
    </View>
  );
}
