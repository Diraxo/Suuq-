import { View, FlatList, Pressable, Alert } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useBlockedUsersStore } from '@/store/blockedUsers';
import { cldUrl } from '@/lib/cloudinary';
import { showSnackbar } from '@/lib/snackbar';

export default function BlockedUsers() {
  const { spacing } = useTheme();
  const router = useRouter();
  const blocked = useBlockedUsersStore((s) => s.blocked);
  const unblock = useBlockedUsersStore((s) => s.unblock);

  const confirmUnblock = (id: string, name: string) => {
    Alert.alert(`Unblock ${name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unblock',
        onPress: async () => {
          await unblock(id);
          showSnackbar(`${name} is unblocked.`);
        },
      },
    ]);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Blocked Users
        </Text>
      </View>

      <FlatList
        data={blocked}
        keyExtractor={(p) => p.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Image source={{ uri: cldUrl(item.avatar, { width: 120 }) }} style={{ width: 44, height: 44, borderRadius: 22 }} cachePolicy="memory-disk" transition={200} />
            <Text variant="bodyMedium" style={{ marginLeft: spacing.sm, flex: 1 }}>
              {item.name}
            </Text>
            <Pressable onPress={() => confirmUnblock(item.id, item.name)} accessibilityRole="button" accessibilityLabel={`Unblock ${item.name}`}>
              <Text variant="caption" color="brand">
                Unblock
              </Text>
            </Pressable>
          </Card>
        )}
        ListEmptyComponent={<EmptyState icon="ban-outline" title="No blocked users" message="Block someone from their profile page and they'll show up here." />}
      />
    </Screen>
  );
}
