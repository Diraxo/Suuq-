import { View, Pressable, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';

export default function About() {
  const { colors, spacing } = useTheme();
  const router = useRouter();

  const rows: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }[] = [
    { icon: 'lock-closed-outline', label: 'Privacy Policy', onPress: () => router.push('/settings/privacy-policy') },
    { icon: 'document-text-outline', label: 'Terms & Conditions', onPress: () => router.push('/settings/terms') },
    { icon: 'mail-outline', label: 'Contact support', onPress: () => Linking.openURL('mailto:support@suuqplus.com') },
  ];

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.lg }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          About Suuq+
        </Text>
      </View>

      <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
        <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="h2" color="inverse">
            S+
          </Text>
        </View>
        <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
          Version {Constants.expoConfig?.version ?? 'unknown'}
        </Text>
      </View>

      <Text variant="body" color="secondary" style={{ marginBottom: spacing.lg }}>
        Suuq+ is a trusted marketplace built for Somalia, Somaliland, Puntland, and the Somali Region of Ethiopia — a
        place to buy and sell everything from phones to property, designed around how people already do business:
        chat, call, meet, and inspect before you pay.
      </Text>

      <View style={{ gap: 2 }}>
        {rows.map((row) => (
          <Pressable key={row.label} onPress={row.onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm }}>
            <Ionicons name={row.icon} size={20} color={colors.textSecondary} />
            <Text variant="body" style={{ marginLeft: spacing.sm, flex: 1 }}>
              {row.label}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
