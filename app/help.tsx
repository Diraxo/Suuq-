import { View, Pressable, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { useTheme } from '@/theme/ThemeContext';

const FAQS = [
  { q: 'How do I post a listing?', a: 'Tap the Sell button in the middle of the tab bar and follow the steps.' },
  { q: 'Is Suuq+ free to use?', a: 'Yes — posting, browsing, and messaging are completely free.' },
  { q: 'How do I stay safe when meeting a buyer or seller?', a: 'Always meet in a public place, inspect the item first, and never send money in advance.' },
  { q: 'How do I report a scam?', a: 'Open the listing or profile and tap Report — our team reviews every report.' },
];

export default function Help() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Help & Support
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        {FAQS.map((f) => (
          <Card key={f.q}>
            <Text variant="bodyMedium">{f.q}</Text>
            <Text variant="caption" color="secondary" style={{ marginTop: 4 }}>
              {f.a}
            </Text>
          </Card>
        ))}
      </View>

      <Pressable
        onPress={() => Linking.openURL('mailto:support@suuqplus.com')}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface }}
      >
        <Ionicons name="mail-outline" size={18} color={colors.primary} />
        <Text variant="bodyMedium" color="brand" style={{ marginLeft: spacing.xs }}>
          Contact support
        </Text>
      </Pressable>
    </Screen>
  );
}
