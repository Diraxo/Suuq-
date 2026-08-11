import { useEffect, useState } from 'react';
import { View, Pressable, Switch, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Skeleton } from '@/components/Skeleton';
import { useTheme } from '@/theme/ThemeContext';
import { supabase } from '@/lib/supabase';
import { push } from '@/lib/push';
import { useAuthStore } from '@/store/auth';

type Category = 'chat' | 'offers' | 'reviews' | 'followers' | 'favorites' | 'price_drops' | 'system' | 'marketing';

type Preferences = Record<Category, boolean>;

const DEFAULT_PREFS: Preferences = {
  chat: true,
  offers: true,
  reviews: true,
  followers: true,
  favorites: true,
  price_drops: true,
  system: true,
  marketing: true,
};

const ITEMS: { key: Category; labelKey: string; descriptionKey: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'chat', labelKey: 'settings.notificationPreferences.categories.chat.label', descriptionKey: 'settings.notificationPreferences.categories.chat.description', icon: 'chatbubble-outline' },
  { key: 'offers', labelKey: 'settings.notificationPreferences.categories.offers.label', descriptionKey: 'settings.notificationPreferences.categories.offers.description', icon: 'pricetag-outline' },
  { key: 'reviews', labelKey: 'settings.notificationPreferences.categories.reviews.label', descriptionKey: 'settings.notificationPreferences.categories.reviews.description', icon: 'star-outline' },
  { key: 'followers', labelKey: 'settings.notificationPreferences.categories.followers.label', descriptionKey: 'settings.notificationPreferences.categories.followers.description', icon: 'people-outline' },
  { key: 'favorites', labelKey: 'settings.notificationPreferences.categories.favorites.label', descriptionKey: 'settings.notificationPreferences.categories.favorites.description', icon: 'heart-outline' },
  { key: 'price_drops', labelKey: 'settings.notificationPreferences.categories.priceDrops.label', descriptionKey: 'settings.notificationPreferences.categories.priceDrops.description', icon: 'trending-down-outline' },
  { key: 'system', labelKey: 'settings.notificationPreferences.categories.system.label', descriptionKey: 'settings.notificationPreferences.categories.system.description', icon: 'information-circle-outline' },
  { key: 'marketing', labelKey: 'settings.notificationPreferences.categories.marketing.label', descriptionKey: 'settings.notificationPreferences.categories.marketing.description', icon: 'megaphone-outline' },
];

export default function NotificationPreferences() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.session?.user.id);

  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    (async () => {
      if (!userId) {
        setLoading(false);
        return;
      }
      const [{ data }, denied] = await Promise.all([
        supabase.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle(),
        push.isPermissionDenied(),
      ]);
      if (data) {
        setPrefs({
          chat: data.chat,
          offers: data.offers,
          reviews: data.reviews,
          followers: data.followers,
          favorites: data.favorites,
          price_drops: data.price_drops,
          system: data.system,
          marketing: data.marketing,
        });
      }
      setPermissionDenied(denied);
      setLoading(false);
    })();
  }, [userId]);

  const toggle = async (key: Category, value: boolean) => {
    if (!userId) return;
    setPrefs((p) => ({ ...p, [key]: value }));
    await supabase
      .from('notification_preferences')
      .upsert({ user_id: userId, ...prefs, [key]: value, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('settings.notificationPreferences.title')}
        </Text>
      </View>

      {permissionDenied && (
        <Card style={{ marginBottom: spacing.md, backgroundColor: colors.warning + '1A' }}>
          <Text variant="bodyMedium">{t('settings.notificationPreferences.disabledTitle')}</Text>
          <Text variant="caption" color="secondary" style={{ marginTop: 2, marginBottom: spacing.sm }}>
            {t('settings.notificationPreferences.disabledMessage')}
          </Text>
          <Pressable
            onPress={() => Linking.openSettings()}
            accessibilityRole="button"
            accessibilityLabel={t('settings.notificationPreferences.openDeviceSettingsA11y')}
          >
            <Text variant="bodyMedium" color="brand">
              {t('settings.notificationPreferences.openSettings')}
            </Text>
          </Pressable>
        </Card>
      )}

      {loading ? (
        <View style={{ gap: spacing.sm }}>
          {ITEMS.map((item) => (
            <Skeleton key={item.key} height={64} radius={radius.md} />
          ))}
        </View>
      ) : (
        <View style={{ gap: spacing.xs }}>
          {ITEMS.map((item) => (
            <View
              key={item.key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: spacing.md,
                borderRadius: radius.md,
                backgroundColor: colors.surface,
              }}
            >
              <Ionicons name={item.icon} size={20} color={colors.textSecondary} />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text variant="bodyMedium">{t(item.labelKey)}</Text>
                <Text variant="caption" color="secondary">
                  {t(item.descriptionKey)}
                </Text>
              </View>
              <Switch
                value={prefs[item.key]}
                onValueChange={(value) => toggle(item.key, value)}
                trackColor={{ true: colors.primary, false: colors.border }}
                accessibilityLabel={t('settings.notificationPreferences.toggleA11y', { category: t(item.labelKey) })}
              />
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
