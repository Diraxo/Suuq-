import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { push } from '@/lib/push';
import { Text } from './Text';

// Foreground pushes never produce a system banner on their own — this is the
// "show an in-app notification, don't silently ignore it" surface for that
// case. Mount once near the root (app/_layout.tsx), next to AuthPromptModal.
export function PushBanner() {
  const { colors, spacing, radius, shadow } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [content, setContent] = useState<{ title: string; body: string } | null>(null);
  const translateY = useRef(new Animated.Value(-120)).current;

  useEffect(() => {
    const unsubscribe = push.onForegroundMessage((title, body) => {
      setContent({ title, body });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!content) return;
    Animated.timing(translateY, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    const timer = setTimeout(() => dismiss(), 4000);
    return () => clearTimeout(timer);
  }, [content]);

  const dismiss = () => {
    Animated.timing(translateY, { toValue: -120, duration: 200, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setContent(null);
    });
  };

  if (!content) return null;

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        top: insets.top + spacing.xs,
        left: spacing.sm,
        right: spacing.sm,
        zIndex: 999,
        transform: [{ translateY }],
      }}
    >
      <Pressable
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel={t('push.dismissLabel', { title: content.title, body: content.body })}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          backgroundColor: colors.surfaceElevated,
          borderRadius: radius.md,
          padding: spacing.sm,
          ...shadow.md,
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: colors.primary + '1A',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="notifications" size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1, marginLeft: spacing.sm }}>
          <Text variant="bodyMedium">{content.title}</Text>
          {!!content.body && (
            <Text variant="caption" color="secondary" numberOfLines={2}>
              {content.body}
            </Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}
