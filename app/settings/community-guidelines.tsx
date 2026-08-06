import { View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Trade in good faith',
    body: 'Describe items honestly, use real photos of what you\'re actually selling, and only list items you have the right to sell. Buyers should ask questions and inspect items before paying.',
  },
  {
    title: 'No illegal or dangerous items',
    body: 'Never list weapons, ammunition, explosives, drugs, or any item illegal to own or sell in your region.',
  },
  {
    title: 'No counterfeit or stolen goods',
    body: 'Listing counterfeit, replica, or stolen items is not allowed and may be reported to local authorities.',
  },
  {
    title: 'No adult content',
    body: 'Suuq+ is a family-friendly marketplace. Sexually explicit content, in listings, photos, or messages, is not allowed.',
  },
  {
    title: 'No scams',
    body: 'Never ask a buyer to pay before they inspect an item, and never send money to a seller you have not met or verified. Suuq+ never asks for payment through the app.',
  },
  {
    title: 'Be respectful',
    body: 'Harassment, hate speech, threats, and impersonating another person or business are not tolerated in listings, messages, or reviews.',
  },
  {
    title: 'What happens if you break these rules',
    body: 'Violating these guidelines can result in listing removal, warnings, or permanent account suspension, depending on severity. Use the Report button on any listing, user, or review to flag a violation.',
  },
];

export default function CommunityGuidelines() {
  const { spacing } = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Community Guidelines
        </Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl, gap: spacing.md }}>
        <Text variant="caption" color="muted">
          Last updated: August 2026
        </Text>
        {SECTIONS.map((s) => (
          <View key={s.title}>
            <Text variant="bodyMedium" style={{ marginBottom: spacing.xxs }}>
              {s.title}
            </Text>
            <Text variant="body" color="secondary">
              {s.body}
            </Text>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
