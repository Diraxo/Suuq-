import { useMemo, useState } from 'react';
import { View, Pressable, FlatList, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';
import { requireAuth } from '@/store/authPrompt';
import { searchProfileEntries, type ProfileSearchEntry } from '@/lib/profileSearch';

type Item = { id: string; labelKey: string; icon: keyof typeof Ionicons.glyphMap; href: string; authRequired?: boolean; section?: 'account' | 'preferences' | 'support' };

// Everything reachable from Profile and Settings. Profile items first (same order as the Profile list), then Settings pages.
// Items that exist in both places (notifications, help, about) are listed once, under Profile.
const ITEMS: Item[] = [
  { id: 'myListings', labelKey: 'profile.menu.myListings', icon: 'list-outline', href: '/my-listings', authRequired: true },
  { id: 'sellerDashboard', labelKey: 'profile.menu.sellerDashboard', icon: 'bar-chart-outline', href: '/seller-dashboard', authRequired: true },
  { id: 'favorites', labelKey: 'profile.menu.favorites', icon: 'heart-outline', href: '/favorites', authRequired: true },
  { id: 'recentlyViewed', labelKey: 'profile.menu.recentlyViewed', icon: 'time-outline', href: '/recently-viewed' },
  { id: 'priceDrops', labelKey: 'profile.menu.priceDrops', icon: 'trending-down-outline', href: '/price-drops', authRequired: true },
  { id: 'savedSearches', labelKey: 'profile.menu.savedSearches', icon: 'bookmark-outline', href: '/saved-searches', authRequired: true },
  { id: 'offers', labelKey: 'profile.menu.offers', icon: 'pricetag-outline', href: '/offers', authRequired: true },
  { id: 'reviews', labelKey: 'profile.menu.reviews', icon: 'star-outline', href: '/reviews', authRequired: true },
  { id: 'followers', labelKey: 'profile.menu.followers', icon: 'people-outline', href: '/followers', authRequired: true },
  { id: 'verification', labelKey: 'profile.menu.verification', icon: 'shield-checkmark-outline', href: '/verification', authRequired: true },
  { id: 'businessDashboard', labelKey: 'profile.menu.businessDashboard', icon: 'business-outline', href: '/business/dashboard', authRequired: true },
  { id: 'notifications', labelKey: 'profile.menu.notifications', icon: 'notifications-outline', href: '/notifications', authRequired: true },
  { id: 'support', labelKey: 'profile.menu.support', icon: 'chatbubbles-outline', href: '/support', authRequired: true },
  { id: 'settings', labelKey: 'profile.menu.settings', icon: 'settings-outline', href: '/settings' },
  { id: 'help', labelKey: 'profile.menu.help', icon: 'help-circle-outline', href: '/help' },
  { id: 'about', labelKey: 'profile.menu.about', icon: 'information-circle-outline', href: '/about' },
  { id: 'editProfile', labelKey: 'settings.editProfile.title', icon: 'person-outline', href: '/settings/edit-profile', authRequired: true, section: 'account' },
  { id: 'businessProfile', labelKey: 'settings.businessProfile.title', icon: 'briefcase-outline', href: '/settings/business-profile', authRequired: true, section: 'account' },
  { id: 'blockedUsers', labelKey: 'settings.blockedUsers.title', icon: 'ban-outline', href: '/settings/blocked-users', authRequired: true, section: 'account' },
  { id: 'savedAddresses', labelKey: 'settings.savedAddresses.title', icon: 'location-outline', href: '/settings/saved-addresses', authRequired: true, section: 'account' },
  { id: 'deleteAccount', labelKey: 'settings.deleteAccount.title', icon: 'trash-outline', href: '/settings/delete-account', authRequired: true, section: 'account' },
  { id: 'appearance', labelKey: 'settings.appearance.title', icon: 'color-palette-outline', href: '/settings/appearance', section: 'preferences' },
  { id: 'language', labelKey: 'settings.language', icon: 'language-outline', href: '/settings/language', section: 'preferences' },
  { id: 'notificationPreferences', labelKey: 'settings.notificationPreferences.title', icon: 'options-outline', href: '/settings/notification-preferences', section: 'preferences' },
  { id: 'safety', labelKey: 'settings.safety.title', icon: 'shield-outline', href: '/settings/safety', section: 'preferences' },
  { id: 'terms', labelKey: 'settings.terms.title', icon: 'document-text-outline', href: '/settings/terms', section: 'support' },
  { id: 'privacyPolicy', labelKey: 'settings.privacyPolicy.title', icon: 'lock-closed-outline', href: '/settings/privacy-policy', section: 'support' },
  { id: 'communityGuidelines', labelKey: 'settings.communityGuidelines.title', icon: 'people-circle-outline', href: '/settings/community-guidelines', section: 'support' },
];

const SECTION_KEY = { account: 'settings.account', preferences: 'settings.index.preferences', support: 'settings.index.support' } as const;

type Entry = ProfileSearchEntry & { icon: Item['icon'] };

/** Full-screen search that replaces the Profile body while open (the WhatsApp "You" search). Shows everything until the user types. */
export function ProfileSearchView({ onClose }: { onClose: () => void }) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [query, setQuery] = useState('');

  // Rebuilt when the language changes (t changes identity), so matching is always against the words on screen.
  const entries = useMemo<Entry[]>(
    () =>
      ITEMS.map((i) => ({
        id: i.id,
        label: t(i.labelKey),
        path: i.section ? `${t('profile.menu.settings')} → ${t(SECTION_KEY[i.section])}` : '',
        href: i.href,
        authRequired: i.authRequired,
        icon: i.icon,
      })),
    [t],
  );
  const results = useMemo(() => searchProfileEntries(entries, query) as Entry[], [entries, query]);

  const open = (e: Entry) => {
    const go = () => router.push(e.href as any);
    if (e.authRequired) requireAuth(go);
    else go();
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs, marginBottom: spacing.sm }}>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            height: 40,
            paddingHorizontal: spacing.sm,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.inputBackground,
          }}
        >
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder={t('profile.search.placeholder')}
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel={t('profile.search.open')}
            style={{ flex: 1, marginLeft: spacing.xs, color: colors.textPrimary, fontSize: 16, paddingVertical: 0 }}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('profile.search.clear')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('profile.search.close')}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.inputBackground }}
        >
          <Ionicons name="close" size={20} color={colors.textPrimary} />
        </Pressable>
      </View>

      {results.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
          <Ionicons name="search-outline" size={40} color={colors.textMuted} />
          <Text variant="bodyMedium" align="center" style={{ marginTop: spacing.sm }}>
            {t('profile.search.noResultsTitle', { query: query.trim() })}
          </Text>
          <Text variant="caption" color="secondary" align="center" style={{ marginTop: spacing.xxs }}>
            {t('profile.search.noResultsHint')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(e) => e.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => open(item)}
              accessibilityRole="button"
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.xs }}
            >
              <Ionicons name={item.icon} size={20} color={colors.textSecondary} />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text variant="body">{item.label}</Text>
                {item.path ? (
                  <Text variant="caption" color="muted">
                    {item.path}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
