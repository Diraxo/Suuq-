import { useEffect } from 'react';
import { View, FlatList, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { useTheme } from '@/theme/ThemeContext';
import { useNotifStore, Notif } from '@/store/notifications';
import { navigateForPush } from '@/lib/push';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';

export default function Notifications() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const notifs = useNotifStore((s) => s.notifs);
  const hasHydrated = useNotifStore((s) => s.hasHydrated);
  const load = useNotifStore((s) => s.load);
  const markAllRead = useNotifStore((s) => s.markAllRead);
  const markOneRead = useNotifStore((s) => s.markOneRead);
  const remove = useNotifStore((s) => s.remove);
  const hasUnread = notifs.some((n) => n.unread);

  useEffect(() => {
    load();
  }, []);

  const openNotif = (item: Notif) => {
    if (item.unread) markOneRead(item.id);
    navigateForPush({ type: item.type ?? undefined, ...(item.data ?? {}) });
  };

  const confirmDelete = (id: string) => {
    Alert.alert(t('notifications.deleteTitle'), t('notifications.deleteMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => remove(id) },
    ]);
  };

  if (!authed) return <Screen />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm, flex: 1 }}>
          {t('settings.notifications')}
        </Text>
        {hasUnread && (
          <Pressable
            onPress={() => markAllRead()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('notifications.markAllReadA11y')}
          >
            <Text variant="bodyMedium" color="brand">
              {t('notifications.markAllRead')}
            </Text>
          </Pressable>
        )}
      </View>

      {!hasHydrated ? (
        <View style={{ gap: spacing.sm }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Skeleton width={36} height={36} radius={18} />
              <View style={{ flex: 1, marginLeft: spacing.sm, gap: 6 }}>
                <Skeleton width="70%" height={14} />
                <Skeleton width="40%" height={12} />
              </View>
            </View>
          ))}
        </View>
      ) : (
      <FlatList
        data={notifs}
        keyExtractor={(n) => n.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openNotif(item)}
            onLongPress={() => confirmDelete(item.id)}
            accessibilityRole="button"
            accessibilityLabel={item.unread ? t('notifications.itemA11yUnread', { title: item.title }) : t('notifications.itemA11y', { title: item.title })}
            style={{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: item.unread ? colors.primary + '0D' : 'transparent', padding: spacing.sm, borderRadius: radius.md }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: spacing.sm }}>
              <Text variant="bodyMedium">{item.title}</Text>
              <Text variant="caption" color="secondary">
                {item.body}
              </Text>
              <Text variant="tiny" color="muted" style={{ marginTop: 2 }}>
                {item.time}
              </Text>
            </View>
            {item.unread && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginTop: 6 }} />}
            <Pressable
              onPress={() => confirmDelete(item.id)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('notifications.deleteTitle')}
              style={{ marginLeft: spacing.xs, padding: 4 }}
            >
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </Pressable>
        )}
        ListEmptyComponent={<EmptyState icon="notifications-outline" title={t('notifications.emptyTitle')} message={t('notifications.emptyMessage')} />}
      />
      )}
    </Screen>
  );
}
