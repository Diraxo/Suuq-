import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { ONBOARDED_KEY } from '@/data/onboarding';

export default function Splash() {
  const { colors, spacing } = useTheme();
  const [minDelayDone, setMinDelayDone] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const session = useAuthStore((s) => s.session);
  const authInitializing = useAuthStore((s) => s.initializing);

  useEffect(() => {
    // Hide the native splash the instant this (visually matching) screen can paint,
    // so the native → JS handoff has no blank flash and no double-splash flicker.
    SplashScreen.hideAsync().catch(() => {});
    const t = setTimeout(() => setMinDelayDone(true), 900);
    AsyncStorage.getItem(ONBOARDED_KEY).then((v) => setOnboarded(v === 'true'));
    return () => clearTimeout(t);
  }, []);

  const ready = minDelayDone && !authInitializing && onboarded !== null;
  // A real restored session means this device has already been through
  // onboarding before — never re-show the first-launch region picker for it.
  const skipOnboarding = onboarded === true || !!session;

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: 24,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.md,
          }}
        >
          <Text variant="h1" color="inverse">
            S+
          </Text>
        </View>
        <Text variant="h2">Suuq+</Text>
        <Text variant="body" color="secondary" style={{ marginTop: 4 }}>
          Buy & sell, trusted.
        </Text>
      </View>
    );
  }

  return <Redirect href={skipOnboarding ? '/(tabs)/home' : '/(onboarding)/select-region'} />;
}
