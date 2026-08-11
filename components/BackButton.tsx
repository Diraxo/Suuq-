import { Pressable, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';

type Props = {
  onPress: () => void;
  color?: string;
  style?: ViewStyle;
};

// 44x44 minimum touch target with hitSlop, per accessibility guidelines —
// use this instead of a bare <Ionicons onPress .../> anywhere a back action is needed.
export function BackButton({ onPress, color, style }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={t('components.backButton.goBack')}
      style={[{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -12 }, style]}
    >
      <Ionicons name="chevron-back" size={22} color={color ?? colors.textPrimary} />
    </Pressable>
  );
}
