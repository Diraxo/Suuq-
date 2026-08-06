import { useCallback, useEffect, useState } from 'react';
import { View, FlatList, Pressable, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import type { Channel } from 'stream-chat';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { streamClient } from '@/lib/stream';
import { supabase } from '@/lib/supabase';
import { cldUrl } from '@/lib/cloudinary';
import { formatRelativeTime } from '@/data/time';
import { useBlockedEitherWayIds } from '@/lib/blocking';

type ListingBadge = { title: string; image: string | null };

type ChatRow = {
  channel: Channel;
  otherId: string | undefined;
  otherName: string;
  otherAvatar: string;
  otherOnline: boolean;
  lastMessage: string;
  lastMessageAt: number;
  unread: number;
  listing: ListingBadge | null;
};

function channelListingId(channel: Channel): string | undefined {
  return (channel.data as { listing_id?: string } | undefined)?.listing_id;
}

async function fetchListingBadges(listingIds: string[]): Promise<Record<string, ListingBadge>> {
  if (listingIds.length === 0) return {};
  const { data } = await supabase.from('listings').select('id, title, images').in('id', listingIds);
  const map: Record<string, ListingBadge> = {};
  for (const row of data ?? []) {
    const r = row as { id: string; title: string; images: string[] | null };
    map[r.id] = { title: r.title, image: r.images?.[0] ?? null };
  }
  return map;
}

export default function Chats() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const meId = useAuthStore((s) => s.session?.user.id);

  const [rows, setRows] = useState<ChatRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const blockedIds = useBlockedEitherWayIds();
  const visibleRows = rows?.filter((r) => !r.otherId || !blockedIds.has(r.otherId)) ?? null;

  const load = useCallback(async () => {
    if (!meId) {
      setRows([]);
      return;
    }
    try {
      const channels = await streamClient.queryChannels(
        { type: 'messaging', members: { $in: [meId] } },
        { last_message_at: -1 },
        { watch: true, state: true, presence: true }
      );

      const listingIds = Array.from(new Set(channels.map(channelListingId).filter((id): id is string => !!id)));
      const badges = await fetchListingBadges(listingIds);

      const nextRows: ChatRow[] = channels.map((channel) => {
        const otherMember = Object.values(channel.state.members).find((m) => m.user_id !== meId);
        const otherUser = otherMember?.user;
        const lastMessage = channel.state.latestMessages[channel.state.latestMessages.length - 1];
        const listingId = channelListingId(channel);

        return {
          channel,
          otherId: otherUser?.id as string | undefined,
          otherName: otherUser?.name ?? 'Suuq+ user',
          otherAvatar: (otherUser?.image as string | undefined) ?? `https://picsum.photos/seed/${otherUser?.id ?? channel.id}/200/200`,
          otherOnline: !!otherUser?.online,
          lastMessage: lastMessage?.text || (lastMessage?.attachments?.length ? 'Sent a photo' : 'No messages yet'),
          lastMessageAt: new Date(channel.state.last_message_at ?? channel.data?.created_at ?? Date.now()).valueOf(),
          unread: channel.countUnread(),
          listing: listingId ? (badges[listingId] ?? null) : null,
        };
      });

      setRows(nextRows);
      setLoadError(false);
    } catch (err) {
      if (__DEV__) console.log('[chats] failed to load conversations:', err);
      setLoadError(true);
      setRows((prev) => prev ?? []);
    }
  }, [meId]);

  useEffect(() => {
    load();
    const handlers = ['message.new', 'message.read', 'notification.mark_read', 'channel.updated'].map((event) =>
      streamClient.on(event, () => load())
    );
    return () => handlers.forEach((h) => h.unsubscribe());
  }, [load]);

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
          keyExtractor={(r) => r.channel.id ?? ''}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/chat/${item.channel.id}` as any)} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View>
                <Image
                  source={{ uri: cldUrl(item.otherAvatar, { width: 160 }) }}
                  accessibilityLabel={`${item.otherName}'s profile photo`}
                  style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.skeleton }}
                  cachePolicy="memory-disk"
                  recyclingKey={item.otherAvatar}
                  transition={200}
                />
                {item.otherOnline && (
                  <View
                    accessibilityLabel="Online"
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
                    source={{ uri: cldUrl(item.listing.image, { width: 80 }) }}
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
              {item.unread > 0 && (
                <View
                  style={{
                    minWidth: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: colors.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 5,
                  }}
                >
                  <Text variant="tiny" color="inverse">
                    {item.unread}
                  </Text>
                </View>
              )}
            </Pressable>
          )}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="No conversations yet" message="Message a seller from any listing to start chatting." />}
        />
      )}
    </Screen>
  );
}
