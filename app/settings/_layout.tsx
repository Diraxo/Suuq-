import { Stack } from 'expo-router';
import { useTheme } from '@/theme/ThemeContext';

// A render error in this route shows a friendly retry screen instead of closing the app.
export { ErrorFallback as ErrorBoundary } from '@/components/ErrorFallback';

export default function SettingsLayout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
