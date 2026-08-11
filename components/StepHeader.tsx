import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';

export function StepHeader({
  step,
  totalSteps,
  title,
  subtitle,
  onClose,
}: {
  step: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  // Step 1 has nowhere to go back to, so its button reads as "close the
  // flow"; every later step's button is a real "back to previous step".
  const isFirstStep = step === 1;

  return (
    <View style={{ paddingTop: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
        <Pressable
          onPress={onClose ?? (() => router.back())}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={isFirstStep ? t('common.close') : t('common.back')}
        >
          <Ionicons name={isFirstStep ? 'close' : 'chevron-back'} size={24} color={colors.textPrimary} />
        </Pressable>
        <Text variant="caption" color="muted" style={{ marginLeft: spacing.sm }}>
          {t('components.stepHeader.stepOf', { step, total: totalSteps })}
        </Text>
      </View>
      <View style={{ height: 4, borderRadius: radius.pill, backgroundColor: colors.border, marginBottom: spacing.md }}>
        <View
          style={{
            width: `${(step / totalSteps) * 100}%`,
            height: '100%',
            borderRadius: radius.pill,
            backgroundColor: colors.primary,
          }}
        />
      </View>
      <Text variant="h2">{title}</Text>
      {subtitle && (
        <Text variant="body" color="secondary" style={{ marginTop: spacing.xxs }}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}
