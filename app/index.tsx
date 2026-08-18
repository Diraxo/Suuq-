import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Redirect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { CategoryIcon } from '@/components/CategoryIcon';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { useLanguageStore } from '@/store/language';
import { ONBOARDED_KEY } from '@/data/onboarding';

// Total time the animated splash stays on screen before navigating away,
// even if auth/onboarding state resolves sooner — gives the logo/glow/name
// and orbit-icon sequence below room to fully play out instead of getting cut short.
const MIN_SPLASH_MS = 2800;

// A handful of the app's real category glyphs (data/categories.ts), orbiting
// the logo — evenly spaced around a circle, top going clockwise.
const ORBIT_ITEMS: { icon: string; angle: number; accent?: boolean }[] = [
  { icon: 'car-outline', angle: -90 },
  { icon: 'restaurant-outline', angle: -45, accent: true },
  { icon: 'phone-portrait-outline', angle: 0 },
  { icon: 'mci:sofa-outline', angle: 45 },
  { icon: 'home-outline', angle: 90, accent: true },
  { icon: 'shirt-outline', angle: 135 },
  { icon: 'football-outline', angle: 180 },
  { icon: 'briefcase-outline', angle: -135, accent: true },
];

const ORBIT_RADIUS = 100;
const CHIP_SIZE = 46;
const RING_SIZE = ORBIT_RADIUS * 2 + CHIP_SIZE;

function OrbitIcon({ item, index }: { item: (typeof ORBIT_ITEMS)[number]; index: number }) {
  const { colors, radius, shadow } = useTheme();
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.3);
  const float = useSharedValue(0);

  useEffect(() => {
    const delay = 320 + index * 80;
    opacity.value = withDelay(delay, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
    scale.value = withDelay(delay, withTiming(1, { duration: 520, easing: Easing.out(Easing.back(1.7)) }));
    // Gentle infinite bob once the entrance settles, desynced per icon so the
    // ring feels alive rather than mechanically uniform.
    float.value = withDelay(
      delay + 500,
      withRepeat(
        withTiming(1, { duration: 1300 + (index % 3) * 220, easing: Easing.inOut(Easing.sin) }),
        -1,
        true
      )
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: interpolate(float.value, [0, 1], [-5, 5]) }, { scale: scale.value }],
  }));

  const rad = (item.angle * Math.PI) / 180;
  const left = RING_SIZE / 2 + ORBIT_RADIUS * Math.cos(rad) - CHIP_SIZE / 2;
  const top = RING_SIZE / 2 + ORBIT_RADIUS * Math.sin(rad) - CHIP_SIZE / 2;
  const tint = item.accent ? colors.accent : colors.primary;

  return (
    <Animated.View
      style={[
        animStyle,
        shadow.sm,
        {
          position: 'absolute',
          left,
          top,
          width: CHIP_SIZE,
          height: CHIP_SIZE,
          borderRadius: radius.md,
          backgroundColor: tint + '1A',
          borderWidth: 1,
          borderColor: tint + '33',
          alignItems: 'center',
          justifyContent: 'center',
        },
      ]}
    >
      <CategoryIcon icon={item.icon} size={20} color={tint} />
    </Animated.View>
  );
}

export default function Splash() {
  const { colors, spacing, isDark } = useTheme();
  const [minDelayDone, setMinDelayDone] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const session = useAuthStore((s) => s.session);
  const authInitializing = useAuthStore((s) => s.initializing);
  const languageHydrated = useLanguageStore((s) => s.hasHydrated);

  // The logo starts fully visible at its final size/opacity (matching the
  // native splash image exactly) so the native -> JS handoff has no blank or
  // scaled-down frame. Only the elements the native splash never showed
  // (glow, orbit icons, name, tagline) animate in afterward.
  const glowOpacity = useSharedValue(0);
  const nameOpacity = useSharedValue(0);
  const taglineOpacity = useSharedValue(0);

  useEffect(() => {
    // Hide the native splash the instant this (visually matching) screen can paint,
    // so the native → JS handoff has no blank flash and no double-splash flicker.
    SplashScreen.hideAsync().catch(() => {});
    const t = setTimeout(() => setMinDelayDone(true), MIN_SPLASH_MS);
    AsyncStorage.getItem(ONBOARDED_KEY).then((v) => setOnboarded(v === 'true'));

    glowOpacity.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) });
    nameOpacity.value = withDelay(550, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
    taglineOpacity.value = withDelay(750, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));

    return () => clearTimeout(t);
  }, []);

  const glowStyle = useAnimatedStyle(() => ({ opacity: glowOpacity.value * 0.35 }));
  const nameStyle = useAnimatedStyle(() => ({ opacity: nameOpacity.value }));
  const taglineStyle = useAnimatedStyle(() => ({ opacity: taglineOpacity.value }));

  const ready = minDelayDone && !authInitializing && languageHydrated && onboarded !== null;
  // A real restored session means this device has already been through
  // onboarding before — never re-show the first-launch onboarding for it.
  const skipOnboarding = onboarded === true || !!session;

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Animated.View style={[glowStyle, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }]}>
          <LinearGradient
            colors={isDark ? [colors.primary + '33', colors.background] : [colors.primary + '22', colors.background]}
            style={{ flex: 1 }}
          />
        </Animated.View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' }}>
            {ORBIT_ITEMS.map((item, i) => (
              <OrbitIcon key={item.icon} item={item} index={i} />
            ))}
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
            {/* Same asset, size, and opacity as the native splash image (app.json) so
                this frame is visually identical to what was on screen just before it. */}
            <Image
              source={require('@/assets/images/fursad-splash.png')}
              style={{ width: 84, height: 84 }}
              contentFit="contain"
            />
          </View>
          <Animated.View style={[nameStyle, { marginTop: -spacing.sm }]}>
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
