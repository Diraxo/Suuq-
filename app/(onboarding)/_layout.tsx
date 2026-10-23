import { Stack } from 'expo-router';

// A render error in this route shows a friendly retry screen instead of closing the app.
export { ErrorFallback as ErrorBoundary } from '@/components/ErrorFallback';

export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
