import { View } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from '@/components/Text';

/** `t` is passed in (rather than calling useTranslation here) because this is a
 *  plain helper, not a component — it's invoked from MessageList's render logic. */
export function dateSeparatorLabel(timestamp: number, t: (key: string) => string): string {
  const d = new Date(timestamp);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return t('chat.today');
  if (diffDays === 1) return t('chat.yesterday');
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export function DateSeparator({ label }: { label: string }) {
  const { colors, spacing, radius } = useTheme();

  return (
    <View style={{ alignItems: 'center', marginVertical: spacing.sm }}>
      <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.inputBackground }}>
        <Text variant="tiny" color="muted">
          {label}
        </Text>
      </View>
    </View>
  );
}
