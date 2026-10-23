import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack, usePathname } from 'expo-router';
import '@/lib/navGuard';
import '@/lib/i18n';
import { setLastPath } from '@/lib/lastRoute';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { ThemeProvider } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { useLanguageStore } from '@/store/language';
import { useRecentlyViewedStore } from '@/store/recentlyViewed';
import { useListingsStore } from '@/store/listings';
import { useLocationStore } from '@/store/location';
import { AuthPromptModal } from '@/components/AuthPromptModal';
import { PushBanner } from '@/components/PushBanner';
import { SnackbarHost } from '@/components/Snackbar';
import { push } from '@/lib/push';
import { useLastSeenHeartbeat } from '@/hooks/useLastSeenHeartbeat';
import { supabase } from '@/lib/supabase';
import { startVisibilitySync } from '@/lib/visibilitySync';
import { getKnownListingIds, useVisibilityStore } from '@/store/visibility';
// Side-effect import: registers the moderation store's auth subscription (account state, notices, support cases + Realtime).
import '@/store/moderation';
import { initCrashReporting } from '@/lib/crashReporting';

// Last-resort screen for a render error anywhere in the app (expo-router wraps the whole route tree with it).
export { ErrorFallback as ErrorBoundary } from '@/components/ErrorFallback';

// Starts crash reporting before the first screen renders (does nothing until EXPO_PUBLIC_SENTRY_DSN is set).
initCrashReporting();

// Keep the native splash (configured in app.json) visible until app/index.tsx
// is ready to paint, so there's no blank flash between native and JS splash.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const pathname = usePathname();
  const hasSession = useAuthStore((s) => !!s.session);
  useLastSeenHeartbeat(hasSession);

  useEffect(() => {
    setLastPath(pathname);
    // app/index.tsx hides the native splash itself on a normal launch. Any other
    // first route (a deep link or notification tap straight to a listing/chat)
    // never mounts it, so hide here instead of leaving the splash up forever.
    if (pathname !== '/') SplashScreen.hideAsync().catch(() => {});
  }, [pathname]);

  // Failsafe: never leave the native splash up if initialization stalls.
  useEffect(() => {
    const t = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 6000);
    return () => clearTimeout(t);
  }, []);

  // Real-time listing visibility: staff removing/deactivating/restoring a listing updates every open screen without
  // a manual refresh. Reconciled with the database on every (re)connect and whenever the app returns to the foreground.
  useEffect(() => {
    const { markHidden, markShown } = useVisibilityStore.getState();
    const sync = startVisibilitySync(supabase as never, {
      onHidden: (id) => {
        markHidden(id);
        useListingsStore.getState().removeLocal(id);
      },
      onShown: (id) => {
        markShown(id);
        // Re-check just this listing (it may have been restored); screens showing it update from the store.
        void useListingsStore.getState().ensure([id], { force: true });
      },
      getKnownIds: () => Array.from(new Set([...getKnownListingIds(), ...useListingsStore.getState().listings.map((l) => l.id)])),
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync.reconcile();
    });
    return () => {
      sub.remove();
      sync.stop();
    };
  }, []);

  useEffect(() => {
    useLanguageStore.getState().load();
    useAuthStore.getState().init();
    // The auth-store subscribe callback in recentlyViewed.ts only (re)loads on
    // a session *transition*, so a guest who never signs in this session
    // would otherwise never load their local AsyncStorage history.
    useRecentlyViewedStore.getState().load();
    useLocationStore.getState().load();

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
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
