import { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeContext';
import { subscribeSnackbar } from '@/lib/snackbar';
import { Text } from './Text';

// The app's one validation/status toast — always a solid dark surface
// regardless of light/dark theme (this is the "black snackbar" every image
// validation and phone-save message uses). Mount once, near the root, next
// to PushBanner/AuthPromptModal.
export function SnackbarHost() {
  const { spacing, radius, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const translateY = useRef(new Animated.Value(80)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => subscribeSnackbar(setMessage), []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: message ? 0 : 80, duration: message ? 220 : 180, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: message ? 1 : 0, duration: message ? 220 : 180, useNativeDriver: true }),
    ]).start();
  }, [message]);

  if (!message) return null;

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: spacing.md,
        right: spacing.md,
        bottom: insets.bottom + spacing.md,
        zIndex: 999,
        transform: [{ translateY }],
        opacity,
      }}
    >
      <View
        style={{
          backgroundColor: '#0F172A',
          borderRadius: radius.md,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          ...shadow.md,
        }}
      >
        <Text variant="body" style={{ color: '#fff' }}>
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}
