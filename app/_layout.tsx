import { useEffect } from 'react';
import { Stack } from 'expo-router';
import '@/lib/navGuard';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { ThemeProvider } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { useRecentlyViewedStore } from '@/store/recentlyViewed';
import { useListingsStore } from '@/store/listings';
import { AuthPromptModal } from '@/components/AuthPromptModal';
import { PushBanner } from '@/components/PushBanner';
import { SnackbarHost } from '@/components/Snackbar';
import { StreamProvider } from '@/components/StreamProvider';
import { push } from '@/lib/push';

// Keep the native splash (configured in app.json) visible until app/index.tsx
// is ready to paint, so there's no blank flash between native and JS splash.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  useEffect(() => {
    useAuthStore.getState().init();
    // The auth-store subscribe callback in recentlyViewed.ts only (re)loads on
    // a session *transition*, so a guest who never signs in this session
    // would otherwise never load their local AsyncStorage history.
    useRecentlyViewedStore.getState().load();
    // The global listings feed is public (no auth required) — load it once at
    // startup so guests see real listings too, not just after signing in.
    useListingsStore.getState().load();

    // Handle the tap that launched the app from a killed state, and any tap
    // that happens while backgrounded — both are one-time listeners for the
    // life of the app, independent of sign-in state.
    push.consumeInitialNotification();
    const unsubscribeTaps = push.listenForTaps();
    return unsubscribeTaps;
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <StreamProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="listing/[id]" options={{ presentation: 'card' }} />
              <Stack.Screen name="seller/[id]" options={{ presentation: 'card' }} />
              <Stack.Screen name="post" options={{ presentation: 'modal', gestureEnabled: false }} />
              <Stack.Screen name="settings" />
            </Stack>
            <AuthPromptModal />
            <PushBanner />
            <SnackbarHost />
          </StreamProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
