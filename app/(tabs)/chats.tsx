import { useEffect, useState } from 'react';
import { View, FlatList, Pressable, RefreshControl, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { ChatRowUnreadBadge } from '@/components/ChatRowUnreadBadge';
import { useTheme } from '@/theme/ThemeContext';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { useChatConversationsStore, ChatListRow } from '@/store/chatConversations';
import { imageUrl } from '@/lib/r2';
import { formatRelativeTime } from '@/data/time';
import { useBlockedEitherWayIds } from '@/lib/blocking';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Fast, non-blocking reorder/insert animation for the chats list. */
const ROW_LAYOUT_ANIMATION = {
  duration: 200,
  update: { type: LayoutAnimation.Types.easeInEaseOut },
} as const;

export default function Chats() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();

  const rows = useChatConversationsStore((s) => s.rows);
  const loadError = useChatConversationsStore((s) => s.loadError);
  const load = useChatConversationsStore((s) => s.load);
  const blockedIds = useBlockedEitherWayIds();
  const visibleRows = rows?.filter((r) => !r.otherId || !blockedIds.has(r.otherId)) ?? null;
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (rows === null) load();
  }, [rows, load]);

  useEffect(() => {
    LayoutAnimation.configureNext(ROW_LAYOUT_ANIMATION);
  }, [rows?.length]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!authed) return <Screen />;

  return (
    <Screen>
      <Text variant="h1" style={{ marginTop: spacing.sm, marginBottom: spacing.md }}>
        Chats
      </Text>
      {rows === null ? (
        <View style={{ gap: spacing.sm }}>
          <Skeleton height={60} />
          <Skeleton height={60} />
          <Skeleton height={60} />
        </View>
      ) : loadError && rows.length === 0 ? (
        <ErrorState message="Couldn't load your chats. Check your connection and try again." onRetry={load} />
      ) : (
        <FlatList
          data={visibleRows}
          keyExtractor={(r) => r.id}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item }: { item: ChatListRow }) => (
            <Pressable onPress={() => router.push(`/chat/${item.id}` as any)} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View>
                <Image
                  source={{ uri: imageUrl(item.otherAvatar, { width: 160 }) }}
                  accessibilityLabel={`${item.otherName}'s profile photo`}
                  style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.skeleton }}
                  cachePolicy="memory-disk"
                  recyclingKey={item.otherAvatar}
                  transition={200}
                />
                {/* item.otherOnline is a last_seen_at heartbeat heuristic
                    ("active somewhere in the app recently"), not the
                    in-conversation realtime presence app/chat/[id].tsx shows —
                    labeled accordingly so this dot doesn't imply the user is
                    actually sitting in this chat right now. */}
                {item.otherOnline && (
                  <View
                    accessibilityLabel="Recently active"
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      width: 13,
                      height: 13,
                      borderRadius: 7,
                      backgroundColor: colors.success,
                      borderWidth: 2,
                      borderColor: colors.background,
                    }}
                  />
                )}
                {item.listing?.image && (
                  <Image
                    source={{ uri: imageUrl(item.listing.image, { width: 80 }) }}
                    style={{
                      position: 'absolute',
                      bottom: -2,
                      right: -2,
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      borderWidth: 2,
                      borderColor: colors.background,
                    }}
                    cachePolicy="memory-disk"
                  />
                )}
              </View>
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="bodyMedium">{item.otherName}</Text>
                  <Text variant="tiny" color="muted">
                    {formatRelativeTime(item.lastMessageAt)}
                  </Text>
                </View>
                <Text variant="caption" color="secondary" numberOfLines={1} style={{ marginTop: 2 }}>
                  {item.lastMessage}
                </Text>
                {item.listing && (
                  <Text variant="tiny" color="muted" numberOfLines={1} style={{ marginTop: 2 }}>
                    Re: {item.listing.title}
                  </Text>
                )}
              </View>
              <ChatRowUnreadBadge count={item.unread} />
            </Pressable>
          )}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="No conversations yet" message="Message a seller from any listing to start chatting." />}
        />
      )}
    </Screen>
  );
}
