import { View, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';
import { requireAuth } from '@/store/authPrompt';

type SettingsItem = { icon: keyof typeof Ionicons.glyphMap; label: string; href: string; authRequired?: boolean; danger?: boolean };

const ACCOUNT_ITEMS: SettingsItem[] = [
  { icon: 'person-outline', label: 'Edit Profile', href: '/settings/edit-profile', authRequired: true },
  { icon: 'briefcase-outline', label: 'Business Profile', href: '/settings/business-profile', authRequired: true },
  { icon: 'ban-outline', label: 'Blocked Users', href: '/settings/blocked-users', authRequired: true },
  { icon: 'location-outline', label: 'Saved Addresses', href: '/settings/saved-addresses', authRequired: true },
  { icon: 'trash-outline', label: 'Delete Account', href: '/settings/delete-account', authRequired: true, danger: true },
];

const PREFERENCES_ITEMS: SettingsItem[] = [
  { icon: 'color-palette-outline', label: 'Appearance', href: '/settings/appearance' },
  { icon: 'language-outline', label: 'Language', href: '/settings/language' },
  { icon: 'notifications-outline', label: 'Notifications', href: '/notifications', authRequired: true },
  { icon: 'options-outline', label: 'Push Notifications', href: '/settings/notification-preferences' },
  { icon: 'shield-outline', label: 'Safety Center', href: '/settings/safety' },
];

const SUPPORT_ITEMS: SettingsItem[] = [
  { icon: 'help-circle-outline', label: 'Help Center', href: '/help' },
  { icon: 'document-text-outline', label: 'Terms of Service', href: '/settings/terms' },
  { icon: 'lock-closed-outline', label: 'Privacy Policy', href: '/settings/privacy-policy' },
  { icon: 'people-circle-outline', label: 'Community Guidelines', href: '/settings/community-guidelines' },
  { icon: 'information-circle-outline', label: 'About', href: '/about' },
];

function SettingsSection({ title, items, onPress }: { title: string; items: SettingsItem[]; onPress: (item: SettingsItem) => void }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="caption" color="muted" style={{ marginBottom: spacing.xs, textTransform: 'uppercase' }}>
        {title}
      </Text>
      {items.map((item) => (
        <Pressable key={item.label} onPress={() => onPress(item)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm }}>
          <Ionicons name={item.icon} size={20} color={item.danger ? colors.error : colors.textSecondary} />
          <Text variant="body" color={item.danger ? 'error' : undefined} style={{ marginLeft: spacing.sm, flex: 1 }}>
            {item.label}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

export default function Settings() {
  const { spacing } = useTheme();
  const router = useRouter();

  const handlePress = (item: SettingsItem) => {
    const go = () => router.push(item.href as any);
    if (item.authRequired) requireAuth(go);
    else go();
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Settings
        </Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }}>
        <SettingsSection title="Account" items={ACCOUNT_ITEMS} onPress={handlePress} />
        <SettingsSection title="Preferences" items={PREFERENCES_ITEMS} onPress={handlePress} />
        <SettingsSection title="Support" items={SUPPORT_ITEMS} onPress={handlePress} />
      </ScrollView>
    </Screen>
  );
}
