import React, { useEffect } from 'react';
import { View, AccessibilityInfo } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { Button } from './Button';

type Props = {
  title?: string;
  message?: string;
  onRetry?: () => void;
};

export function ErrorState({ title = 'Something went wrong', message = "We couldn't load this. Check your connection and try again.", onRetry }: Props) {
  const { colors, spacing } = useTheme();

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`${title}. ${message}`);
  }, []);

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', padding: spacing.xxl }} accessible accessibilityRole="alert">
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: colors.error + '1A',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.md,
        }}
      >
        <Ionicons name="alert-circle-outline" size={30} color={colors.error} />
      </View>
      <Text variant="h3" align="center">
        {title}
      </Text>
      <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs, marginBottom: spacing.lg }}>
        {message}
      </Text>
      {onRetry && <Button label="Try again" onPress={onRetry} />}
    </View>
  );
}
