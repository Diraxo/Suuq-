import { Stack } from 'expo-router';
import { useTheme } from '@/theme/ThemeContext';

export default function SettingsLayout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
