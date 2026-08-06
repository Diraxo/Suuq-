import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';

export default function Offline() {
  const { colors, spacing } = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl }}>
        <Ionicons name="cloud-offline-outline" size={56} color={colors.textMuted} />
        <Text variant="h2" align="center" style={{ marginTop: spacing.md }}>
          You&apos;re offline
        </Text>
        <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs, marginBottom: spacing.lg }}>
          Check your connection — you can still browse listings you&apos;ve already viewed.
        </Text>
        <Button label="Try again" onPress={() => router.replace('/(tabs)/home')} />
      </View>
    </Screen>
  );
}
