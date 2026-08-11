import { View, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';
import { requireAuth } from '@/store/authPrompt';

type SettingsItem = { icon: keyof typeof Ionicons.glyphMap; labelKey: string; href: string; authRequired?: boolean; danger?: boolean };

const ACCOUNT_ITEMS: SettingsItem[] = [
  { icon: 'person-outline', labelKey: 'settings.editProfile.title', href: '/settings/edit-profile', authRequired: true },
  { icon: 'briefcase-outline', labelKey: 'settings.businessProfile.title', href: '/settings/business-profile', authRequired: true },
  { icon: 'ban-outline', labelKey: 'settings.blockedUsers.title', href: '/settings/blocked-users', authRequired: true },
  { icon: 'location-outline', labelKey: 'settings.savedAddresses.title', href: '/settings/saved-addresses', authRequired: true },
  { icon: 'trash-outline', labelKey: 'settings.deleteAccount.title', href: '/settings/delete-account', authRequired: true, danger: true },
];

const PREFERENCES_ITEMS: SettingsItem[] = [
  { icon: 'color-palette-outline', labelKey: 'settings.appearance.title', href: '/settings/appearance' },
  { icon: 'language-outline', labelKey: 'settings.language', href: '/settings/language' },
  { icon: 'notifications-outline', labelKey: 'settings.notifications', href: '/notifications', authRequired: true },
  { icon: 'options-outline', labelKey: 'settings.notificationPreferences.title', href: '/settings/notification-preferences' },
  { icon: 'shield-outline', labelKey: 'settings.safety.title', href: '/settings/safety' },
];

const SUPPORT_ITEMS: SettingsItem[] = [
  { icon: 'help-circle-outline', labelKey: 'settings.index.helpCenter', href: '/help' },
  { icon: 'document-text-outline', labelKey: 'settings.terms.title', href: '/settings/terms' },
  { icon: 'lock-closed-outline', labelKey: 'settings.privacyPolicy.title', href: '/settings/privacy-policy' },
  { icon: 'people-circle-outline', labelKey: 'settings.communityGuidelines.title', href: '/settings/community-guidelines' },
  { icon: 'information-circle-outline', labelKey: 'settings.index.about', href: '/about' },
];

function SettingsSection({ title, items, onPress }: { title: string; items: SettingsItem[]; onPress: (item: SettingsItem) => void }) {
  const { colors, spacing } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="caption" color="muted" style={{ marginBottom: spacing.xs, textTransform: 'uppercase' }}>
        {title}
      </Text>
      {items.map((item) => (
        <Pressable key={item.labelKey} onPress={() => onPress(item)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm }}>
          <Ionicons name={item.icon} size={20} color={item.danger ? colors.error : colors.textSecondary} />
          <Text variant="body" color={item.danger ? 'error' : undefined} style={{ marginLeft: spacing.sm, flex: 1 }}>
            {t(item.labelKey)}
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
  const { t } = useTranslation();

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
          {t('settings.title')}
        </Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }}>
        <SettingsSection title={t('settings.account')} items={ACCOUNT_ITEMS} onPress={handlePress} />
        <SettingsSection title={t('settings.index.preferences')} items={PREFERENCES_ITEMS} onPress={handlePress} />
        <SettingsSection title={t('settings.index.support')} items={SUPPORT_ITEMS} onPress={handlePress} />
      </ScrollView>
    </Screen>
  );
}
