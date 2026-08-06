import { useEffect, useState } from 'react';
import { View, Pressable, Switch, Linking } from 'react-native';
import { useRouter } from 'expo-router';
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

const ITEMS: { key: Category; label: string; description: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'chat', label: 'Chat', description: 'New messages from buyers and sellers', icon: 'chatbubble-outline' },
  { key: 'offers', label: 'Offers', description: 'New, countered, accepted, and rejected offers', icon: 'pricetag-outline' },
  { key: 'reviews', label: 'Reviews', description: 'New and edited reviews on your profile', icon: 'star-outline' },
  { key: 'followers', label: 'Followers', description: 'When someone follows you', icon: 'people-outline' },
  { key: 'favorites', label: 'Favorites', description: 'When someone favorites your listing', icon: 'heart-outline' },
  { key: 'price_drops', label: 'Price drops', description: 'Price drops on listings you favorited', icon: 'trending-down-outline' },
  { key: 'system', label: 'System', description: 'Account and listing status updates', icon: 'information-circle-outline' },
  { key: 'marketing', label: 'Marketing', description: 'Announcements and promotions', icon: 'megaphone-outline' },
];

export default function NotificationPreferences() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
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
          Push Notifications
        </Text>
      </View>

      {permissionDenied && (
        <Card style={{ marginBottom: spacing.md, backgroundColor: colors.warning + '1A' }}>
          <Text variant="bodyMedium">Notifications are turned off for Suuq+</Text>
          <Text variant="caption" color="secondary" style={{ marginTop: 2, marginBottom: spacing.sm }}>
            Enable notifications in your device settings to receive pushes for the categories below.
          </Text>
          <Pressable
            onPress={() => Linking.openSettings()}
            accessibilityRole="button"
            accessibilityLabel="Open device notification settings"
          >
            <Text variant="bodyMedium" color="brand">
              Open Settings
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
                <Text variant="bodyMedium">{item.label}</Text>
                <Text variant="caption" color="secondary">
                  {item.description}
                </Text>
              </View>
              <Switch
                value={prefs[item.key]}
                onValueChange={(value) => toggle(item.key, value)}
                trackColor={{ true: colors.primary, false: colors.border }}
                accessibilityLabel={`${item.label} notifications`}
              />
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
