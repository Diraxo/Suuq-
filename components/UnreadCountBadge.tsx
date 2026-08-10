import { Animated } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { formatUnreadCount } from '@/store/chatUnread';
import { useUnreadBadgeAnimation } from '@/hooks/useUnreadBadgeAnimation';
import { Text } from './Text';

/** Small count badge absolutely positioned over an icon (tab bar, bell button) — animates in/out via useUnreadBadgeAnimation. Wrap the icon in a plain `<View>` and render this as its sibling. */
export function UnreadCountBadge({ count, color = '#FF6B6B' }: { count: number; color?: string }) {
  const { spacing } = useTheme();
  const visible = count > 0;
  const { mounted, scale, opacity } = useUnreadBadgeAnimation(visible);

  if (!mounted) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute',
        top: -4,
        right: -10,
        minWidth: 17,
        height: 17,
        borderRadius: 9,
        paddingHorizontal: spacing.xxs,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color,
        transform: [{ scale }],
        opacity,
      }}
    >
      <Text variant="tiny" style={{ color: '#FFFFFF', fontSize: 10, lineHeight: 12 }}>
        {formatUnreadCount(count)}
      </Text>
    </Animated.View>
  );
}
