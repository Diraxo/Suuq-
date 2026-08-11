import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { useLanguageStore } from '@/store/language';
import { ONBOARDED_KEY } from '@/data/onboarding';

// Total time the animated splash stays on screen before navigating away,
// even if auth/onboarding state resolves sooner — gives the logo/glow/name
// sequence below room to fully play out instead of getting cut short.
const MIN_SPLASH_MS = 2400;

export default function Splash() {
  const { colors, spacing, isDark } = useTheme();
  const [minDelayDone, setMinDelayDone] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const session = useAuthStore((s) => s.session);
  const authInitializing = useAuthStore((s) => s.initializing);
  const languageHydrated = useLanguageStore((s) => s.hasHydrated);

  const glowOpacity = useSharedValue(0);
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.95);
  const nameOpacity = useSharedValue(0);
  const taglineOpacity = useSharedValue(0);

  useEffect(() => {
    // Hide the native splash the instant this (visually matching) screen can paint,
    // so the native → JS handoff has no blank flash and no double-splash flicker.
    SplashScreen.hideAsync().catch(() => {});
    const t = setTimeout(() => setMinDelayDone(true), MIN_SPLASH_MS);
    AsyncStorage.getItem(ONBOARDED_KEY).then((v) => setOnboarded(v === 'true'));

    glowOpacity.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) });
    logoOpacity.value = withDelay(150, withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }));
    logoScale.value = withDelay(150, withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }));
    nameOpacity.value = withDelay(550, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
    taglineOpacity.value = withDelay(750, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));

    return () => clearTimeout(t);
  }, []);

  const glowStyle = useAnimatedStyle(() => ({ opacity: glowOpacity.value * 0.35 }));
  const logoStyle = useAnimatedStyle(() => ({ opacity: logoOpacity.value, transform: [{ scale: logoScale.value }] }));
  const nameStyle = useAnimatedStyle(() => ({ opacity: nameOpacity.value }));
  const taglineStyle = useAnimatedStyle(() => ({ opacity: taglineOpacity.value }));

  const ready = minDelayDone && !authInitializing && languageHydrated && onboarded !== null;
  // A real restored session means this device has already been through
  // onboarding before — never re-show the first-launch onboarding for it.
  const skipOnboarding = onboarded === true || !!session;

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LinearGradient
          colors={isDark ? [colors.primary + '33', colors.background] : [colors.primary + '22', colors.background]}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View
              style={[
                glowStyle,
                {
                  position: 'absolute',
                  width: 200,
                  height: 200,
                  borderRadius: 100,
                  backgroundColor: colors.primary,
                },
              ]}
            />
            <Animated.View
              style={[
                logoStyle,
                {
                  width: 84,
                  height: 84,
                  borderRadius: 24,
                  backgroundColor: colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: spacing.md,
                },
              ]}
            >
              <Text variant="h1" color="inverse">
                F
              </Text>
            </Animated.View>
          </View>
          <Animated.View style={nameStyle}>
            <Text variant="h2">Fursad</Text>
          </Animated.View>
          <Animated.View style={taglineStyle}>
            <Text variant="body" color="secondary" style={{ marginTop: 4 }}>
              Buy & sell, trusted.
            </Text>
          </Animated.View>
        </View>
      </View>
    );
  }

  return <Redirect href={skipOnboarding ? '/(tabs)/home' : '/(onboarding)/language'} />;
}
