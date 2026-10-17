import { View, FlatList, Pressable, Alert } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useBlockedUsersStore } from '@/store/blockedUsers';
import { imageUrl } from '@/lib/r2';
import { showSnackbar } from '@/lib/snackbar';

export default function BlockedUsers() {
  const { spacing } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const blocked = useBlockedUsersStore((s) => s.blocked);
  const unblock = useBlockedUsersStore((s) => s.unblock);

  const confirmUnblock = (id: string, name: string) => {
    Alert.alert(t('settings.blockedUsers.confirmUnblockTitle', { name }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.unblock'),
        onPress: async () => {
          await unblock(id);
          showSnackbar(t('settings.blockedUsers.unblockedSnackbar', { name }));
        },
      },
    ]);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('settings.blockedUsers.title')}
        </Text>
      </View>

      <FlatList
        data={blocked}
        keyExtractor={(p) => p.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable onPress={() => router.push(`/seller/${item.id}` as any)} accessibilityRole="button" accessibilityLabel={t('safety.viewProfileOf', { name: item.name })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
              <Image source={{ uri: imageUrl(item.avatar, { width: 120 }) }} style={{ width: 44, height: 44, borderRadius: 22 }} cachePolicy="memory-disk" transition={200} />
              <Text variant="bodyMedium" style={{ marginLeft: spacing.sm, flex: 1 }}>
                {item.name}
              </Text>
            </Pressable>
            <Pressable onPress={() => confirmUnblock(item.id, item.name)} hitSlop={10} style={{ paddingLeft: spacing.sm }} accessibilityRole="button" accessibilityLabel={t('settings.blockedUsers.unblockAccessibilityLabel', { name: item.name })}>
              <Text variant="caption" color="brand">
                {t('common.unblock')}
              </Text>
            </Pressable>
          </Card>
        )}
        ListEmptyComponent={<EmptyState icon="ban-outline" title={t('settings.blockedUsers.emptyTitle')} message={t('settings.blockedUsers.emptyMessage')} />}
      />
    </Screen>
  );
}
