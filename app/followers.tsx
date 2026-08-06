import { useState } from 'react';
import { View, FlatList, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useFollowStore } from '@/store/follow';
import { requireAuth } from '@/store/authPrompt';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { cldUrl } from '@/lib/cloudinary';

export default function FollowersFollowing() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const params = useLocalSearchParams<{ initial?: string }>();
  const [tab, setTab] = useState<'followers' | 'following'>(params.initial === 'following' ? 'following' : 'followers');
  const followers = useFollowStore((s) => s.followers);
  const following = useFollowStore((s) => s.following);
  const followingIds = useFollowStore((s) => s.followingIds);
  const toggleFollow = useFollowStore((s) => s.toggle);

  const people = tab === 'followers' ? followers : following;

  if (!authed) return <Screen />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {tab === 'followers' ? 'Followers' : 'Following'}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.md }}>
        {(['followers', 'following'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)}>
            <Text variant="bodyMedium" color={tab === t ? 'brand' : 'muted'} style={{ textTransform: 'capitalize' }}>
              {t}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={people}
        keyExtractor={(p) => p.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => {
          const isFollowing = followingIds.has(item.id);
          return (
            <Pressable onPress={() => router.push(`/seller/${item.id}`)} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Image source={{ uri: cldUrl(item.avatar, { width: 120 }) }} style={{ width: 44, height: 44, borderRadius: 22 }} cachePolicy="memory-disk" recyclingKey={item.avatar} transition={200} />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text variant="bodyMedium">{item.name}</Text>
                <Text variant="caption" color="secondary">
                  {item.city}
                </Text>
              </View>
              <Button
                label={isFollowing ? 'Following' : 'Follow'}
                size="sm"
                variant={isFollowing ? 'outline' : 'primary'}
                onPress={() => requireAuth(() => toggleFollow(item.id))}
              />
            </Pressable>
          );
        }}
        ListEmptyComponent={<EmptyState icon="people-outline" title={`No ${tab} yet`} />}
      />
    </Screen>
  );
}
