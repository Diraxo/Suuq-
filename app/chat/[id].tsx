import { useEffect, useMemo, useState } from 'react';
import { View, Pressable, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Channel as StreamChannel, ChannelData } from 'stream-chat';
import { Channel, MessageList, MessageComposer } from 'stream-chat-expo';
import type { IconProps } from 'stream-chat-expo';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Skeleton } from '@/components/Skeleton';
import { ErrorState } from '@/components/ErrorState';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { streamClient } from '@/lib/stream';
import { supabase } from '@/lib/supabase';
import { cldUrl } from '@/lib/cloudinary';
import { useBlockedEitherWayIds, isBlockedEitherWaySync } from '@/lib/blocking';
import { EmptyState } from '@/components/EmptyState';
import { formatRelativeTime } from '@/data/time';
import { formatBirr } from '@/lib/currency';

const QUICK_REPLIES = ['Is this still available?', 'Best price?', 'Can I see it today?'];

const CONVERSATION_SELECT =
  'id, listing_id, buyer_id, seller_id,' +
  ' listing:listings(id,title,price,currency,images),' +
  ' buyer:profiles!conversations_buyer_id_fkey(id,full_name,avatar_url,phone),' +
  ' seller:profiles!conversations_seller_id_fkey(id,full_name,avatar_url,phone)';

type ConversationRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  listing: { id: string; title: string; price: number; currency: string; images: string[] } | null;
  buyer: { id: string; full_name: string | null; avatar_url: string | null; phone: string | null } | null;
  seller: { id: string; full_name: string | null; avatar_url: string | null; phone: string | null } | null;
};

type ResolvedConversation = {
  id: string;
  buyerId: string;
  sellerId: string;
  listing: { id: string; title: string; price: number; currency: string; image: string | null };
  withUser: { id: string; name: string; avatar: string; phone: string | null };
};

function rowToResolved(row: ConversationRow, meId: string): ResolvedConversation {
  const other = row.buyer_id === meId ? row.seller : row.buyer;
  return {
    id: row.id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    listing: {
      id: row.listing?.id ?? row.listing_id,
      title: row.listing?.title ?? '',
      price: row.listing?.price ?? 0,
      currency: row.listing?.currency ?? 'ETB',
      image: row.listing?.images?.[0] ?? null,
    },
    withUser: {
      id: other?.id ?? '',
      name: other?.full_name ?? 'Suuq+ user',
      avatar: other?.avatar_url ?? `https://picsum.photos/seed/${other?.id ?? 'user'}/200/200`,
      phone: other?.phone ?? null,
    },
  };
}

/** Accepts either a conversation id (from the chats list / a push tap) or a listing id (from a listing/seller "Chat" button) — same dual resolution the old store/chat.ts used. */
async function resolveConversation(param: string, meId: string): Promise<ResolvedConversation | null> {
  const { data: existing } = await supabase.from('conversations').select(CONVERSATION_SELECT).eq('id', param).maybeSingle();
  if (existing) return rowToResolved(existing as unknown as ConversationRow, meId);

  const { data: created, error } = await supabase.rpc('find_or_create_conversation', { p_listing_id: param });
  if (error || !created) return null;

  const { data: full } = await supabase.from('conversations').select(CONVERSATION_SELECT).eq('id', created.id).maybeSingle();
  if (!full) return null;
  return rowToResolved(full as unknown as ConversationRow, meId);
}

function emojiIcon(emoji: string) {
  return function EmojiIcon({ size }: IconProps) {
    return <Text style={{ fontSize: size ?? 24, lineHeight: (size ?? 24) + 2 }}>{emoji}</Text>;
  };
}

const SUPPORTED_REACTIONS = [
  { type: 'like', Icon: emojiIcon('👍') },
  { type: 'love', Icon: emojiIcon('❤️') },
  { type: 'haha', Icon: emojiIcon('😂') },
  { type: 'wow', Icon: emojiIcon('😮') },
  { type: 'sad', Icon: emojiIcon('😢') },
  { type: 'clap', Icon: emojiIcon('👏') },
];

export default function ChatScreen() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const authed = useRequireAuthScreen();
  const meId = useAuthStore((s) => s.session?.user.id);
  const insets = useSafeAreaInsets();

  const [resolved, setResolved] = useState<ResolvedConversation | null>(null);
  const [channel, setChannel] = useState<StreamChannel | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [presence, setPresence] = useState<{ online: boolean; lastActive: string | null }>({ online: false, lastActive: null });
  const [hasMessages, setHasMessages] = useState(false);
  const blockedIds = useBlockedEitherWayIds();
  const isBlocked = !!resolved && blockedIds.has(resolved.withUser.id);

  useEffect(() => {
    if (!id || !meId) return;
    let cancelled = false;
    let presenceUnsub: (() => void) | null = null;
    setLoading(true);
    setNotFound(false);

    (async () => {
      try {
        const conv = await resolveConversation(id, meId);
        if (cancelled) return;
        if (!conv) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setResolved(conv);
        if (isBlockedEitherWaySync(conv.withUser.id)) {
          setLoading(false);
          return;
        }

        const ch = streamClient.channel('messaging', conv.id, {
          members: [conv.buyerId, conv.sellerId],
          name: conv.listing.title,
          image: conv.listing.image ?? undefined,
          listing_id: conv.listing.id,
        } as ChannelData & { listing_id: string });
        await ch.watch();
        if (cancelled) return;
        setChannel(ch);
        setLoading(false);
        ch.markRead().catch(() => {});
        setHasMessages(ch.state.messages.length > 0);

        const otherMember = ch.state.members[conv.withUser.id]?.user;
        setPresence({ online: !!otherMember?.online, lastActive: otherMember?.last_active ?? null });
        const subscription = ch.on('user.presence.changed', (event) => {
          if (event.user?.id === conv.withUser.id) {
            setPresence({ online: !!event.user.online, lastActive: event.user.last_active ?? null });
          }
        });
        const newMessageSubscription = ch.on('message.new', () => setHasMessages(true));
        presenceUnsub = () => {
          subscription.unsubscribe();
          newMessageSubscription.unsubscribe();
        };
      } catch (err) {
        if (cancelled) return;
        if (__DEV__) console.log('[chat] failed to open conversation:', err);
        setNotFound(true);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      presenceUnsub?.();
    };
  }, [id, meId]);

  const priceLabel = useMemo(() => {
    if (!resolved) return '';
    return formatBirr(resolved.listing.price);
  }, [resolved]);

  if (resolved && isBlocked) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
          <BackButton onPress={() => router.back()} />
        </View>
        <EmptyState icon="ban-outline" title="Conversation unavailable" message="You can't message this user." />
      </Screen>
    );
  }

  if (!authed) return <Screen noPadding />;

  if (loading || !channel || !resolved) {
    if (notFound) {
      return (
        <Screen edges={['top', 'left', 'right', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
            <BackButton onPress={() => router.back()} />
          </View>
          <ErrorState title="Conversation unavailable" message="This chat can't be opened right now." onRetry={() => router.back()} />
        </Screen>
      );
    }
    return (
      <Screen noPadding>
        <View style={{ padding: spacing.md, gap: spacing.sm }}>
          <Skeleton height={44} radius={22} />
          <Skeleton height={60} />
          <Skeleton height={60} width="70%" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen noPadding edges={['top', 'left', 'right', 'bottom']}>
      <>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <BackButton onPress={() => router.back()} />
        <View>
          <Image
            source={{ uri: cldUrl(resolved.withUser.avatar, { width: 120 }) }}
            accessibilityLabel={`${resolved.withUser.name}'s profile photo`}
            style={{ width: 36, height: 36, borderRadius: 18, marginLeft: spacing.sm }}
            cachePolicy="memory-disk"
            transition={200}
          />
          {presence.online && (
            <View
              accessibilityLabel="Online"
              style={{ position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: 6, backgroundColor: colors.success, borderWidth: 2, borderColor: colors.background }}
            />
          )}
        </View>
        <View style={{ marginLeft: spacing.xs, flex: 1 }}>
          <Text variant="bodyMedium">{resolved.withUser.name}</Text>
          <Text variant="tiny" color={presence.online ? 'success' : 'muted'} numberOfLines={1}>
            {presence.online ? 'Online' : presence.lastActive ? `Last seen ${formatRelativeTime(new Date(presence.lastActive).valueOf())}` : resolved.listing.title}
          </Text>
        </View>
        {resolved.withUser.phone && (
          <Pressable
            onPress={() => Linking.openURL(`tel:${resolved.withUser.phone}`)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Call ${resolved.withUser.name}`}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 }}
          >
            <Ionicons name="call-outline" size={20} color={colors.primary} />
          </Pressable>
        )}
      </View>

      <Pressable
        onPress={() => router.push(`/listing/${resolved.listing.id}` as any)}
        accessibilityRole="button"
        accessibilityLabel={`Open listing: ${resolved.listing.title}`}
        style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}
      >
        {resolved.listing.image && (
          <Image
            source={{ uri: cldUrl(resolved.listing.image, { width: 160 }) }}
            style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.skeleton }}
            cachePolicy="memory-disk"
            transition={200}
          />
        )}
        <View style={{ flex: 1 }}>
          <Text variant="caption" numberOfLines={1}>
            {resolved.listing.title}
          </Text>
          <Text variant="tiny" color="brand">
            {priceLabel}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Pressable>
      </>

      <Channel
        channel={channel}
        audioRecordingEnabled={false}
        hasImagePicker={false}
        hasCameraPicker={false}
        hasFilePicker={false}
        hasCommands={false}
        supportedReactions={SUPPORTED_REACTIONS}
        keyboardVerticalOffset={insets.top}
        additionalKeyboardAvoidingViewProps={{ style: { flex: 1 } }}
        messageActions={({ copyMessage, quotedReply, deleteMessage, pinMessage, unpinMessage }) => [copyMessage, quotedReply, deleteMessage, pinMessage, unpinMessage].filter(Boolean)}
      >
        <MessageList />

        <View style={{ flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, marginBottom: spacing.xs }}>
          <Pressable
            onPress={() => router.push(`/offers?listingId=${resolved.listing.id}&currency=${resolved.listing.currency}` as any)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Make an offer"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: spacing.sm,
              paddingVertical: 6,
              borderRadius: radius.pill,
              backgroundColor: colors.primary + '0D',
              borderWidth: 1,
              borderColor: colors.primary,
            }}
          >
            <Ionicons name="pricetag-outline" size={12} color={colors.primary} />
            <Text variant="tiny" color="brand" style={{ marginLeft: 4 }}>
              Make an offer
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/pickup-planner' as any)}
            accessibilityRole="button"
            accessibilityLabel="Plan pickup"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: spacing.sm,
              paddingVertical: 6,
              borderRadius: radius.pill,
              backgroundColor: colors.primary + '0D',
              borderWidth: 1,
              borderColor: colors.primary,
            }}
          >
            <Ionicons name="location-outline" size={12} color={colors.primary} />
            <Text variant="tiny" color="brand" style={{ marginLeft: 4 }}>
              Plan pickup
            </Text>
          </Pressable>
        </View>

        {!hasMessages && (
          <View style={{ flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, marginBottom: spacing.xs }}>
            {QUICK_REPLIES.map((q) => (
              <Pressable
                key={q}
                onPress={() => {
                  setHasMessages(true);
                  channel.sendMessage({ text: q });
                }}
                style={{
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 6,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text variant="tiny" color="secondary">
                  {q}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <MessageComposer />
      </Channel>
    </Screen>
  );
}
