import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Redirect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts } from 'expo-font';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import Animated, {
  Easing,
  interpolate,
  ReduceMotion,
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

// Reanimated follows the OS "Reduce Motion" / "remove animations" setting by
// default and, when it is on, snaps every withTiming/withRepeat straight to its
// end value — icons appear already settled and never bob. This brand intro is
// short and fixed, so it plays identically on every device regardless of that
// setting.
const NO_REDUCE = { reduceMotion: ReduceMotion.Never };

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

// SUUQIYE brand indigo — matches app.json's expo-splash-screen backgroundColor
// and the adaptive-icon field, so the native (Android 12 system) splash and
// this JS splash share one background and the white monogram never changes
// colour across the handoff.
const SPLASH_BG = '#4F46E5';
const SPLASH_BG_DEEP = '#3F46BB';
// Apparent monogram size — kept equal to app.json expo-splash-screen.imageWidth
// so the mark does not jump size between the two splash stages.
const SPLASH_MARK = 160;

function OrbitIcon({ item, index }: { item: (typeof ORBIT_ITEMS)[number]; index: number }) {
  const { radius, shadow } = useTheme();
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.3);
  const float = useSharedValue(0);

  useEffect(() => {
    const delay = 320 + index * 80;
    opacity.value = withDelay(delay, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic), ...NO_REDUCE }), ReduceMotion.Never);
    scale.value = withDelay(delay, withTiming(1, { duration: 520, easing: Easing.out(Easing.back(1.7)), ...NO_REDUCE }), ReduceMotion.Never);
    // Gentle infinite bob once the entrance settles, desynced per icon so the
    // ring feels alive rather than mechanically uniform.
    float.value = withDelay(
      delay + 500,
      withRepeat(
        withTiming(1, { duration: 1300 + (index % 3) * 220, easing: Easing.inOut(Easing.sin), ...NO_REDUCE }),
        -1,
        true,
        undefined,
        ReduceMotion.Never
      ),
      ReduceMotion.Never
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: interpolate(float.value, [0, 1], [-5, 5]) }, { scale: scale.value }],
  }));

  const rad = (item.angle * Math.PI) / 180;
  const left = RING_SIZE / 2 + ORBIT_RADIUS * Math.cos(rad) - CHIP_SIZE / 2;
  const top = RING_SIZE / 2 + ORBIT_RADIUS * Math.sin(rad) - CHIP_SIZE / 2;
  // On the indigo splash field every chip is white glass, so the ring reads as
  // one brand system rather than scattered colour.
  const tint = '#FFFFFF';

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
          backgroundColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.22)',
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
  const { spacing } = useTheme();
  const [minDelayDone, setMinDelayDone] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const session = useAuthStore((s) => s.session);
  const authInitializing = useAuthStore((s) => s.initializing);
  const languageHydrated = useLanguageStore((s) => s.hasHydrated);
  // The orbit chips mount only once the icon fonts are loaded, so their entrance
  // plays with glyphs already drawn (no blank chips). The fonts are bundled, so
  // this resolves in milliseconds and never gates the splash timer or navigation;
  // on a load error the chips mount anyway rather than leaving the ring empty.
  const [fontsLoaded, fontError] = useFonts({ ...Ionicons.font, ...MaterialCommunityIcons.font });

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

    glowOpacity.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.quad), ...NO_REDUCE });
    nameOpacity.value = withDelay(550, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic), ...NO_REDUCE }), ReduceMotion.Never);
    taglineOpacity.value = withDelay(750, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic), ...NO_REDUCE }), ReduceMotion.Never);

    return () => clearTimeout(t);
  }, []);

  const glowStyle = useAnimatedStyle(() => ({ opacity: glowOpacity.value * 0.2 }));
  const nameStyle = useAnimatedStyle(() => ({ opacity: nameOpacity.value }));
  const taglineStyle = useAnimatedStyle(() => ({ opacity: taglineOpacity.value }));

  const ready = minDelayDone && !authInitializing && languageHydrated && onboarded !== null;
  // A real restored session means this device has already been through
  // onboarding before — never re-show the first-launch onboarding for it.
  const skipOnboarding = onboarded === true || !!session;

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: SPLASH_BG }}>
        {/* Static brand-indigo field — identical to the Android 12 system splash
            background — so the first painted frame simply continues it. */}
        <LinearGradient colors={[SPLASH_BG, SPLASH_BG_DEEP]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' }}>
            {(fontsLoaded || fontError) && ORBIT_ITEMS.map((item, i) => (
              <OrbitIcon key={item.icon} item={item} index={i} />
            ))}
            <Animated.View
              style={[
                glowStyle,
                {
                  position: 'absolute',
                  width: 220,
                  height: 220,
                  borderRadius: 110,
                  backgroundColor: '#FFFFFF',
                },
              ]}
            />
            {/* Same asset and apparent size as the native splash image (app.json)
                so the native → JS handoff has no size jump or colour flash. */}
            <Image
              source={require('@/assets/images/fursad-splash.png')}
              style={{ width: SPLASH_MARK, height: SPLASH_MARK }}
              contentFit="contain"
            />
          </View>
          <Animated.View style={[nameStyle, { marginTop: -spacing.sm }]}>
            <Text variant="h2" style={{ color: '#FFFFFF' }}>SUUQIYE</Text>
          </Animated.View>
          <Animated.View style={taglineStyle}>
            <Text variant="body" style={{ marginTop: 4, color: 'rgba(255,255,255,0.85)' }}>
              Buy & sell, trusted.
            </Text>
          </Animated.View>
        </View>
      </View>
    );
  }

  return <Redirect href={skipOnboarding ? '/(tabs)/home' : '/(onboarding)/language'} />;
}
