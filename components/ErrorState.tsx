import React, { useEffect } from 'react';
import { View, AccessibilityInfo } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { Button } from './Button';

type Props = {
  title?: string;
  message?: string;
  onRetry?: () => void;
};

export function ErrorState({ title, message, onRetry }: Props) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('common.somethingWentWrong');
  const resolvedMessage = message ?? t('components.errorState.message');
  const { colors, spacing } = useTheme();

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`${resolvedTitle}. ${resolvedMessage}`);
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
        {resolvedTitle}
      </Text>
      <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs, marginBottom: spacing.lg }}>
        {resolvedMessage}
      </Text>
      {onRetry && <Button label={t('common.retry')} onPress={onRetry} />}
    </View>
  );
}
