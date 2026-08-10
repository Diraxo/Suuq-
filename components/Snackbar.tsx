import { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeContext';
import { subscribeSnackbar, SnackbarPayload } from '@/lib/snackbar';
import { Text } from './Text';

// The app's one validation/status toast — always a solid dark surface
// regardless of light/dark theme (this is the "black snackbar" every image
// validation and phone-save message uses). Mount once, near the root, next
// to PushBanner/AuthPromptModal.
export function SnackbarHost() {
  const { colors, spacing, radius, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const [payload, setPayload] = useState<SnackbarPayload>(null);
  const translateY = useRef(new Animated.Value(80)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => subscribeSnackbar(setPayload), []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: payload ? 0 : 80, duration: payload ? 220 : 180, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: payload ? 1 : 0, duration: payload ? 220 : 180, useNativeDriver: true }),
    ]).start();
  }, [payload]);

  if (!payload) return null;

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
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#0F172A',
          borderRadius: radius.md,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          ...shadow.md,
        }}
      >
        {payload.tone === 'success' && (
          <Ionicons name="checkmark-circle" size={18} color={colors.success} style={{ marginRight: spacing.xs }} />
        )}
        <Text variant="body" style={{ color: '#fff' }}>
          {payload.message}
        </Text>
      </View>
    </Animated.View>
  );
}
