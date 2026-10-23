import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// A render error in this route shows a friendly retry screen instead of closing the app.
export { ErrorFallback as ErrorBoundary } from '@/components/ErrorFallback';

// Re-provide safe-area measurements inside this modal-presented stack: the
// outer SafeAreaProvider (app/_layout.tsx) measures the root window, but
// react-native-screens mounts a `presentation: 'modal'` route in its own
// native view hierarchy, so screens here can otherwise read stale/incorrect
// bottom insets — the cause of Continue/Publish buttons sitting under the
// home indicator on this flow specifically.
export default function PostLayout() {
  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
