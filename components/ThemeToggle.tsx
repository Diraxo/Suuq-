import { useEffect, useRef } from 'react';
import { View, Pressable, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeContext';

const SEGMENT_WIDTH = 32;
const SEGMENT_HEIGHT = 28;
const TOGGLE_DURATION = 220;
const TOGGLE_EASING = Easing.out(Easing.cubic);

/**
 * Compact ☀/🌙 shortcut for the Profile header — a two-state stand-in for the
 * full Appearance screen (Light/Dark/Match system), which stays reachable from
 * Settings for anyone who wants "system". Tapping always sets an explicit
 * light/dark mode (never "system"), so the active side here stays unambiguous.
 */
export function ThemeToggle() {
  const { colors, radius, shadow, isDark, setMode } = useTheme();
  // Native-driven: slides the indicator and crossfades the icon layers on the UI thread.
  // (Ionicons' setNativeProps doesn't forward to its inner Text node, so animating
  // `color` directly via the JS driver crashes — opacity crossfade sidesteps that.)
  const progress = useRef(new Animated.Value(isDark ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: isDark ? 1 : 0,
      duration: TOGGLE_DURATION,
      easing: TOGGLE_EASING,
      useNativeDriver: true,
    }).start();
  }, [isDark, progress]);

  const activeOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const inactiveOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.inputBackground,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 3,
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: 3,
            top: 3,
            width: SEGMENT_WIDTH,
            height: SEGMENT_HEIGHT,
            borderRadius: radius.pill,
            backgroundColor: colors.primary,
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, SEGMENT_WIDTH],
                }),
              },
            ],
          },
          shadow.sm,
        ]}
      />
      <Pressable
        onPress={() => setMode('light')}
        hitSlop={{ top: 8, bottom: 8, left: 10, right: 2 }}
        accessibilityRole="button"
        accessibilityLabel="Switch to light theme"
        accessibilityState={{ selected: !isDark }}
        style={({ pressed }) => [
          {
            width: SEGMENT_WIDTH,
            height: SEGMENT_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
          },
          pressed && { opacity: 0.65 },
        ]}
      >
        <Animated.View style={{ position: 'absolute', opacity: inactiveOpacity }}>
          <Ionicons name="sunny" size={15} color={colors.primaryText} />
        </Animated.View>
        <Animated.View style={{ position: 'absolute', opacity: activeOpacity }}>
          <Ionicons name="sunny" size={15} color={colors.textSecondary} />
        </Animated.View>
      </Pressable>
      <Pressable
        onPress={() => setMode('dark')}
        hitSlop={{ top: 8, bottom: 8, left: 2, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Switch to dark theme"
        accessibilityState={{ selected: isDark }}
        style={({ pressed }) => [
          {
            width: SEGMENT_WIDTH,
            height: SEGMENT_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
          },
          pressed && { opacity: 0.65 },
        ]}
      >
        <Animated.View style={{ position: 'absolute', opacity: inactiveOpacity }}>
          <Ionicons name="moon" size={14} color={colors.textSecondary} />
        </Animated.View>
        <Animated.View style={{ position: 'absolute', opacity: activeOpacity }}>
          <Ionicons name="moon" size={14} color={colors.primaryText} />
        </Animated.View>
      </Pressable>
    </View>
  );
}
