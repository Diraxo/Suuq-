import { useEffect, useMemo, useState } from 'react';
import { View, Pressable, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Skeleton } from '@/components/Skeleton';
import { ErrorState } from '@/components/ErrorState';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { useConversationChannel, ChatMessage, ReactionType } from '@/hooks/useConversationChannel';
import { supabase } from '@/lib/supabase';
import { imageUrl } from '@/lib/r2';
import { useBlockedEitherWayIds, isBlockedEitherWaySync } from '@/lib/blocking';
import { EmptyState } from '@/components/EmptyState';
import { formatRelativeTime } from '@/data/time';
import { formatBirr } from '@/lib/currency';
import { MessageList } from '@/components/chat/MessageList';
import { MessageComposer } from '@/components/chat/MessageComposer';
import { MessageActionSheet } from '@/components/chat/MessageActionSheet';
import { MessageImageViewer } from '@/components/chat/MessageImageViewer';

const QUICK_REPLY_KEYS = ['isAvailable', 'bestPrice', 'canSeeToday'] as const;

const CONVERSATION_SELECT =
  'id, listing_id, buyer_id, seller_id,' +
  ' listing:listings(id,title,price,currency,images),' +
  ' buyer:profiles!conversations_buyer_id_fkey(id,full_name,avatar_url,phone,last_seen_at),' +
  ' seller:profiles!conversations_seller_id_fkey(id,full_name,avatar_url,phone,last_seen_at)';

type ConversationRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  listing: { id: string; title: string; price: number; currency: string; images: string[] } | null;
  buyer: { id: string; full_name: string | null; avatar_url: string | null; phone: string | null; last_seen_at: string | null } | null;
  seller: { id: string; full_name: string | null; avatar_url: string | null; phone: string | null; last_seen_at: string | null } | null;
};

type ResolvedConversation = {
  id: string;
  buyerId: string;
  sellerId: string;
  listing: { id: string; title: string; price: number; currency: string; image: string | null };
  withUser: { id: string; name: string; avatar: string; phone: string | null; lastSeenAt: string | null };
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
      name: other?.full_name ?? 'SUUQIYE user',
      avatar: other?.avatar_url ?? `https://picsum.photos/seed/${other?.id ?? 'user'}/200/200`,
      phone: other?.phone ?? null,
      lastSeenAt: other?.last_seen_at ?? null,
    },
  };
}

/** Accepts either a conversation id (from the chats list / a push tap) or a listing id (from a listing/seller "Chat" button) â€” same dual resolution the old store/chat.ts used. */
async function resolveConversation(param: string, meId: string): Promise<ResolvedConversation | null> {
  const { data: existing } = await supabase.from('conversations').select(CONVERSATION_SELECT).eq('id', param).maybeSingle();
  if (existing) return rowToResolved(existing as unknown as ConversationRow, meId);

  const { data: created, error } = await supabase.rpc('find_or_create_conversation', { p_listing_id: param });
  if (error || !created) return null;

  const { data: full } = await supabase.from('conversations').select(CONVERSATION_SELECT).eq('id', created.id).maybeSingle();
  if (!full) return null;
  return rowToResolved(full as unknown as ConversationRow, meId);
}

export default function ChatScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const authed = useRequireAuthScreen();
  const meId = useAuthStore((s) => s.session?.user.id);
  const insets = useSafeAreaInsets();

  const [resolved, setResolved] = useState<ResolvedConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const blockedIds = useBlockedEitherWayIds();
  const isBlocked = !!resolved && blockedIds.has(resolved.withUser.id);

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null);
  const [viewerImages, setViewerImages] = useState<{ images: string[]; index: number } | null>(null);

  useEffect(() => {
    if (!id || !meId) return;
    let cancelled = false;
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
        if (isBlockedEitherWaySync(conv.withUser.id)) {
          setResolved(conv);
          setLoading(false);
          return;
        }
        setResolved(conv);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (__DEV__) console.log('[chat] failed to open conversation:', err);
        setNotFound(true);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, meId]);

  const chat = useConversationChannel(resolved && !isBlocked ? resolved.id : null, meId ?? null, resolved ? resolved.withUser.id : null);

  const priceLabel = useMemo(() => (resolved ? formatBirr(resolved.listing.price) : ''), [resolved]);

  // "Online" is reserved for chat.presence.online — realtime presence scoped
  // to this conversation's channel, i.e. the other person genuinely has this
  // chat open right now. Being active elsewhere in the app (last_seen_at)
  // only ever renders as "Last seen X ago", never "Online", so the two
  // signals can't be confused for each other.
  const subtitle = useMemo(() => {
    if (!resolved) return '';
    if (chat.typingUser) return t('chat.isTyping', { name: resolved.withUser.name });
    if (chat.presence.online) return t('chat.online');
    if (resolved.withUser.lastSeenAt) return t('chat.lastSeen', { time: formatRelativeTime(new Date(resolved.withUser.lastSeenAt).valueOf()) });
    return resolved.listing.title;
  }, [resolved, chat.typingUser, chat.presence.online, t]);

  const myReactionFor = (message: ChatMessage): ReactionType | null => (message.reactions.find((r) => r.userId === meId)?.reaction ?? null);

  if (resolved && isBlocked) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
          <BackButton onPress={() => router.back()} />
        </View>
        <EmptyState icon="ban-outline" title={t('chat.unavailableTitle')} message={t('chat.cantMessageUser')} />
      </Screen>
    );
  }

  if (!authed) return <Screen noPadding />;

  if (loading || !resolved || !meId) {
    if (notFound) {
      return (
        <Screen edges={['top', 'left', 'right', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
            <BackButton onPress={() => router.back()} />
          </View>
          <ErrorState title={t('chat.unavailableTitle')} message={t('chat.cantOpenChat')} onRetry={() => router.back()} />
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
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <BackButton onPress={() => router.back()} />
        <View>
          <Image
            source={{ uri: imageUrl(resolved.withUser.avatar, { width: 120 }) }}
            accessibilityLabel={t('chat.profilePhotoAlt', { name: resolved.withUser.name })}
            style={{ width: 36, height: 36, borderRadius: 18, marginLeft: spacing.sm }}
            cachePolicy="memory-disk"
            transition={200}
          />
          {chat.presence.online && (
            <View
              accessibilityLabel={t('chat.online')}
              style={{ position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: 6, backgroundColor: colors.success, borderWidth: 2, borderColor: colors.background }}
            />
          )}
        </View>
        <View style={{ marginLeft: spacing.xs, flex: 1 }}>
          <Text variant="bodyMedium">{resolved.withUser.name}</Text>
          <Text variant="tiny" color={chat.typingUser ? 'brand' : chat.presence.online ? 'success' : 'muted'} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        {resolved.withUser.phone && (
          <Pressable
            onPress={() => Linking.openURL(`tel:${resolved.withUser.phone}`)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('chat.callUser', { name: resolved.withUser.name })}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 }}
          >
            <Ionicons name="call-outline" size={20} color={colors.primary} />
          </Pressable>
        )}
      </View>

      <Pressable
        onPress={() => router.push(`/listing/${resolved.listing.id}` as any)}
        accessibilityRole="button"
        accessibilityLabel={t('chat.openListing', { title: resolved.listing.title })}
        style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}
      >
        {resolved.listing.image && (
          <Image
            source={{ uri: imageUrl(resolved.listing.image, { width: 160 }) }}
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

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
        {chat.initializing ? (
          <View style={{ flex: 1, padding: spacing.md, gap: spacing.sm }}>
            <Skeleton height={60} width="60%" />
            <Skeleton height={60} width="70%" style={{ alignSelf: 'flex-end' }} />
            <Skeleton height={60} width="50%" />
          </View>
        ) : (
          <MessageList
            messages={chat.messages}
            meId={meId}
            peerLastReadAt={chat.peerLastReadAt}
            initialUnreadCount={chat.initialUnreadCount}
            hasMore={chat.hasMore}
            loadingOlder={chat.loadingOlder}
            onLoadOlder={chat.loadOlder}
            onLongPressMessage={setActionMessage}
            onImagePress={(images, index) => setViewerImages({ images, index })}
            onRetry={chat.retrySend}
            onDismissFailed={chat.dismissFailed}
          />
        )}

        <View style={{ flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, marginBottom: spacing.xs }}>
          <Pressable
            onPress={() => router.push(`/offers?listingId=${resolved.listing.id}&currency=${resolved.listing.currency}` as any)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('chat.makeOffer')}
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
              {t('chat.makeOffer')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/pickup-planner' as any)}
            accessibilityRole="button"
            accessibilityLabel={t('chat.planPickup')}
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
              {t('chat.planPickup')}
            </Text>
          </Pressable>
        </View>

        {!chat.initializing && chat.messages.length === 0 && (
          <View style={{ flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, marginBottom: spacing.xs }}>
            {QUICK_REPLY_KEYS.map((key) => {
              const q = t(`chat.quickReplies.${key}`);
              return (
                <Pressable
                  key={key}
                  onPress={() => chat.sendMessage({ text: q })}
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
              );
            })}
          </View>
        )}

        <MessageComposer
          onSend={chat.sendMessage}
          onTyping={chat.sendTyping}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onSubmitEdit={(msgId, text) => {
            chat.editMessage(msgId, text);
            setEditing(null);
          }}
          uploadFolder={`chat/${resolved.id}/${meId}`}
        />
      </KeyboardAvoidingView>

      <MessageActionSheet
        message={actionMessage}
        isMine={actionMessage?.senderId === meId}
        myReaction={actionMessage ? myReactionFor(actionMessage) : null}
        onClose={() => setActionMessage(null)}
        onReply={(msg) => {
          setReplyTo(msg);
          setActionMessage(null);
        }}
        onEdit={(msg) => {
          setEditing(msg);
          setActionMessage(null);
        }}
        onDelete={(msg) => {
          chat.deleteMessage(msg.id);
          setActionMessage(null);
        }}
        onReact={(msg, reaction) => {
          chat.toggleReaction(msg.id, reaction);
          setActionMessage(null);
        }}
      />

      {viewerImages && <MessageImageViewer images={viewerImages.images} initialIndex={viewerImages.index} onClose={() => setViewerImages(null)} />}
    </Screen>
  );
}
