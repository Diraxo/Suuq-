import { Animated } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { formatUnreadCount } from '@/store/chatUnread';
import { useUnreadBadgeAnimation } from '@/hooks/useUnreadBadgeAnimation';
import { Text } from './Text';

/** Per-conversation unread count badge for a chats-list row — same enter/exit animation as the tab icon's ChatUnreadBadge, positioned inline instead of absolutely. */
export function ChatRowUnreadBadge({ count }: { count: number }) {
  const { colors } = useTheme();
  const visible = count > 0;
  const { mounted, scale, opacity } = useUnreadBadgeAnimation(visible);

  if (!mounted) return null;

  return (
    <Animated.View
      style={{
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 5,
        transform: [{ scale }],
        opacity,
      }}
    >
      <Text variant="tiny" color="inverse">
        {formatUnreadCount(count)}
      </Text>
    </Animated.View>
  );
}
