import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from '@/components/Text';

/** A centred, non-bubble line inside the thread ("You blocked X"), visible only to the person it is about. */
export function SystemNotice({ text, icon }: { text: string; icon: keyof typeof Ionicons.glyphMap }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View style={{ alignItems: 'center', marginVertical: spacing.xs, paddingHorizontal: spacing.md }}>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.inputBackground, maxWidth: '90%' }}
      >
        <Ionicons name={icon} size={14} color={colors.textMuted} />
        <Text variant="tiny" color="muted" style={{ flexShrink: 1 }}>
          {text}
        </Text>
      </View>
    </View>
  );
}
