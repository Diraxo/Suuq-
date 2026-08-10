import { View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'What we collect',
    body: 'Account info (name, email, and photo from Google sign-in), profile details you add (phone number, location, bio, business info), listing content and photos you upload, a device notification token used to deliver push notifications, and basic usage data (searches, views, app crashes) used to keep Suuq+ working and improving.',
  },
  {
    title: 'Photos and images',
    body: 'Photos you upload — listing photos, your profile picture, business logo/banner — are stored with Cloudflare R2, our image hosting provider, and served through Supabase-backed records that store only the resulting image URLs. We never store your raw photo files in our own database.',
  },
  {
    title: 'Your phone number',
    body: 'Your phone number is stored once on your profile and shown to buyers on your listings so they can contact you — it is never sold or shared outside the app. You can update or remove it anytime in Edit Profile.',
  },
  {
    title: 'How we use your data',
    body: 'To operate the marketplace (show your listings, connect you with buyers/sellers via chat, send relevant notifications), to keep the platform safe (reviewing reports, blocking abusive accounts), and to improve the app based on aggregate, de-identified usage patterns.',
  },
  {
    title: 'Sharing',
    body: 'We share data with the service providers that run Suuq+ — Supabase (database, authentication, and in-app chat), Cloudflare R2 (image hosting), and push notification providers — solely to provide the app\'s functionality. We do not sell your personal data to advertisers or data brokers.',
  },
  {
    title: 'Your choices',
    body: 'You can edit or delete most of your data from Settings at any time, including your profile, listings, and saved addresses. Deleting your account removes your profile and associated content, subject to what we\'re required to retain for legal or safety reasons.',
  },
  {
    title: 'Account deletion',
    body: 'From Settings > Delete Account, you can permanently delete your account. This is irreversible and removes your profile, listings and photos, favorites, followers/following, reviews, business profile, saved searches and addresses, notifications, device tokens, and chat conversations from our systems.',
  },
  {
    title: 'Contact',
    body: 'Questions about this policy or your data can be sent to support@suuqplus.com.',
  },
];

export default function PrivacyPolicy() {
  const { spacing } = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Privacy Policy
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
