import { View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: '1. Using Suuq+',
    body: 'Suuq+ is a marketplace that connects buyers and sellers in Somalia, Somaliland, Puntland, and the Somali Region of Ethiopia. You must be at least 18 years old, or have a parent/guardian\'s permission, to create an account. You are responsible for everything posted from your account.',
  },
  {
    title: '2. Listings',
    body: 'Sellers must accurately describe items, own the right to sell them, and use real photos of the actual item for sale. Suuq+ is not a party to any transaction between buyers and sellers — we do not handle payments, shipping, or escrow, and we are not responsible for the quality, safety, or legality of items listed.',
  },
  {
    title: '3. Prohibited items and conduct',
    body: 'You may not list stolen, counterfeit, illegal, or dangerous goods, or use Suuq+ to harass, scam, mislead, or impersonate another person or business. We may remove any listing or account that violates these terms, local law, or community safety, at our discretion and without prior notice.',
  },
  {
    title: '4. Meeting and paying safely',
    body: 'We strongly recommend meeting in a public place, inspecting an item before paying, and never sending money in advance to someone you have not met. Suuq+ cannot reverse a payment made outside the app and is not liable for losses from in-person transactions.',
  },
  {
    title: '5. Your content',
    body: 'You keep ownership of photos and text you upload, but you grant Suuq+ a license to host, display, and (where relevant) show a "Posted on Suuq+" overlay on your content within the app, so listings can be browsed and shared. You are responsible for having the rights to anything you upload.',
  },
  {
    title: '6. Account suspension',
    body: 'We may suspend or terminate accounts that violate these terms, receive repeated credible reports, or engage in fraudulent activity. You can request account deletion at any time from Settings.',
  },
  {
    title: '7. Intellectual property',
    body: 'The Suuq+ name, logo, and app design are owned by Suuq+ and may not be copied or used without permission. You keep ownership of your own content as described above.',
  },
  {
    title: '8. Changes to these terms',
    body: 'We may update these terms as Suuq+ evolves. Continued use of the app after a change means you accept the updated terms.',
  },
  {
    title: '9. Contact',
    body: 'Questions about these terms can be sent to support@suuqplus.com.',
  },
];

export default function Terms() {
  const { spacing } = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Terms of Service
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
