import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from '@/components/Text';

/** Count is frozen at screen-mount time (hook's initialUnreadCount) so this
 *  divider doesn't jump around as messages get marked read live. */
export function UnreadSeparator({ count }: { count: number }) {
  const { colors, spacing } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: spacing.sm }}>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.accent + '55' }} />
      <Text variant="tiny" color="accent" style={{ marginHorizontal: spacing.sm }}>
        {t('chat.unreadMessages', { count })}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.accent + '55' }} />
    </View>
  );
}
