import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useTranslation } from 'react-i18next';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { showSnackbar } from '@/lib/snackbar';

// Everything app/chat/[id].tsx needs for one open conversation: realtime
// message/edit/delete/reaction/read-state sync, keyset pagination, optimistic
// send, typing broadcast, and in-thread presence — all scoped to a single
// `chat:<conversationId>` realtime channel that multiplexes postgres_changes
// + broadcast + presence for that thread.

export type ReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'clap';

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  text: string | null;
  images: string[];
  // Parallel array to `images` (same index == same photo) — the R2 object
  // key backing each image, so it can be deleted when the message is
  // deleted. Empty/shorter than `images` for legacy rows sent before R2 key
  // persistence existed; those images still display fine, they just have
  // nothing to clean up server-side.
  imageKeys: string[];
  replyToId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  status: 'sending' | 'sent' | 'failed';
  reactions: { userId: string; reaction: ReactionType }[];
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string | null;
  images: string[];
  image_keys: string[] | null;
  reply_to_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

type ReactionRow = { id: string; message_id: string; user_id: string; reaction: ReactionType; conversation_id?: string };
type ParticipantRow = { user_id: string; last_read_at: string | null };

export type Presence = { online: boolean; lastActive: string | null };

const PAGE_SIZE = 30;
const TYPING_THROTTLE_MS = 2500;
const TYPING_TIMEOUT_MS = 5000;
const MARK_READ_DEBOUNCE_MS = 800;
// Safety cap on how many messages a single initial load / reconnect catch-up
// will ever pull in one shot, so a very large unread backlog or a very long
// disconnect can't force-load an entire conversation.
const MAX_CATCHUP_LOAD = 200;

const MESSAGE_SELECT = 'id, conversation_id, sender_id, text, images, image_keys, reply_to_id, edited_at, deleted_at, created_at';

function tempId(): string {
  return 'temp-' + 'xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

function rowToMessage(row: MessageRow, status: ChatMessage['status'] = 'sent'): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    text: row.text,
    images: row.images ?? [],
    imageKeys: row.image_keys ?? [],
    replyToId: row.reply_to_id,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    status,
    reactions: [],
  };
}

function sortDesc(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function mergeReaction(list: ChatMessage[], messageId: string, userId: string, reaction: ReactionType): ChatMessage[] {
  return list.map((m) =>
    m.id === messageId ? { ...m, reactions: [...m.reactions.filter((r) => r.userId !== userId), { userId, reaction }] } : m
  );
}

function removeReaction(list: ChatMessage[], messageId: string, userId: string): ChatMessage[] {
  return list.map((m) => (m.id === messageId ? { ...m, reactions: m.reactions.filter((r) => r.userId !== userId) } : m));
}

async function fetchReactionsFor(rows: MessageRow[]): Promise<ReactionRow[]> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const { data } = await supabase.from('message_reactions').select('id, message_id, user_id, reaction').in('message_id', ids);
  return (data as ReactionRow[]) ?? [];
}

// Server-side count, independent of PAGE_SIZE — the unread divider must be
// accurate even when far more than one page of messages is unread.
async function fetchUnreadCount(conversationId: string, meId: string, sinceIso: string | null): Promise<number> {
  let query = supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .neq('sender_id', meId)
    .is('deleted_at', null);
  if (sinceIso) query = query.gt('created_at', sinceIso);
  const { count } = await query;
  return count ?? 0;
}

function buildMessages(rows: MessageRow[], reactions: ReactionRow[]): ChatMessage[] {
  return rows.map((row) => {
    const msg = rowToMessage(row);
    msg.reactions = reactions.filter((r) => r.message_id === row.id).map((r) => ({ userId: r.user_id, reaction: r.reaction }));
    return msg;
  });
}

export function useConversationChannel(conversationId: string | null, meId: string | null, otherUserId: string | null) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [typingUser, setTypingUser] = useState(false);
  const [presence, setPresence] = useState<Presence>({ online: false, lastActive: null });
  const [peerLastReadAt, setPeerLastReadAt] = useState<string | null>(null);
  const [initialUnreadCount, setInitialUnreadCount] = useState(0);
  const [initializing, setInitializing] = useState(true);

  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasConnectedOnceRef = useRef(false);

  const upsertMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      if (idx === -1) return sortDesc([msg, ...prev]);
      const next = [...prev];
      next[idx] = { ...msg, reactions: next[idx].reactions };
      return next;
    });
  }, []);

  const scheduleMarkRead = useCallback(
    (immediate = false) => {
      if (!conversationId) return;
      const run = () => {
        markReadTimerRef.current = null;
        supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId }).then(undefined, () => {});
      };
      if (immediate) {
        if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
        markReadTimerRef.current = null;
        run();
        return;
      }
      if (markReadTimerRef.current) return;
      markReadTimerRef.current = setTimeout(run, MARK_READ_DEBOUNCE_MS);
    },
    [conversationId]
  );

  const loadInitial = useCallback(async () => {
    if (!conversationId || !meId) return;
    const [{ data: msgRows }, { data: participants }] = await Promise.all([
      supabase
        .from('messages')
        .select(MESSAGE_SELECT)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE),
      supabase.from('conversation_participants').select('user_id, last_read_at').eq('conversation_id', conversationId),
    ]);

    let rows = (msgRows as MessageRow[]) ?? [];
    setHasMore(rows.length === PAGE_SIZE);

    const peer = (participants as ParticipantRow[] | null)?.find((p) => p.user_id !== meId)?.last_read_at ?? null;
    const mine = (participants as ParticipantRow[] | null)?.find((p) => p.user_id === meId)?.last_read_at ?? null;
    setPeerLastReadAt(peer);

    // Accurate count via a server-side COUNT, not the first page's contents —
    // the old code derived this from `rows`, which silently capped the
    // divider at PAGE_SIZE unread messages.
    const unreadCount = await fetchUnreadCount(conversationId, meId, mine);
    setInitialUnreadCount(unreadCount);

    // The divider can only render at the right spot if the boundary message
    // is actually in `rows`. If there's more unread than the first page
    // holds, pull in just enough older messages to reach it (capped, so a
    // huge backlog never forces loading the whole conversation).
    if (unreadCount > rows.length && rows.length === PAGE_SIZE) {
      const extraNeeded = Math.min(unreadCount - rows.length, MAX_CATCHUP_LOAD - rows.length);
      if (extraNeeded > 0) {
        const cursor = rows[rows.length - 1];
        const { data: extraRows } = await supabase
          .from('messages')
          .select(MESSAGE_SELECT)
          .eq('conversation_id', conversationId)
          .or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(extraNeeded);
        const more = (extraRows as MessageRow[]) ?? [];
        rows = [...rows, ...more];
        setHasMore(more.length === extraNeeded);
      }
    }

    const reactions = await fetchReactionsFor(rows);
    setMessages(buildMessages(rows, reactions));
    scheduleMarkRead(true);
    setInitializing(false);
  }, [conversationId, meId, scheduleMarkRead]);

  const loadOlder = useCallback(async () => {
    if (!conversationId || loadingOlder || !hasMore) return;
    const cursor = messagesRef.current[messagesRef.current.length - 1];
    if (!cursor) return;
    setLoadingOlder(true);
    try {
      const { data } = await supabase
        .from('messages')
        .select(MESSAGE_SELECT)
        .eq('conversation_id', conversationId)
        .or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);

      const rows = (data as MessageRow[]) ?? [];
      setHasMore(rows.length === PAGE_SIZE);
      if (rows.length > 0) {
        const reactions = await fetchReactionsFor(rows);
        const built = buildMessages(rows, reactions);
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          return [...prev, ...built.filter((m) => !existingIds.has(m.id))];
        });
      }
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, hasMore, loadingOlder]);

  const refetchNewest = useCallback(async () => {
    if (!conversationId) return;
    const { data } = await supabase
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE);
    for (const row of (data as MessageRow[]) ?? []) upsertMessage(rowToMessage(row));
  }, [conversationId, upsertMessage]);

  // Runs when the realtime channel comes back up after a drop (not the first
  // connect — that's loadInitial's job). Fills the gap the disconnect left:
  // any messages inserted while offline (cursor-based catch-up off the
  // newest confirmed message, so nothing is missed no matter how long the
  // gap was), plus a refresh of whatever's currently on screen so missed
  // edits/deletes/reactions and peer read-state show up too. Everything is
  // merged into existing state by id — never a full replace — so paginated
  // history and unconfirmed optimistic messages are left untouched and
  // nothing flickers or duplicates.
  const resyncAfterReconnect = useCallback(async () => {
    if (!conversationId || !meId) return;
    const current = messagesRef.current;
    const newestConfirmed = current.find((m) => m.status !== 'sending' && m.status !== 'failed');
    if (!newestConfirmed) return; // nothing loaded yet; loadInitial will handle it

    const { data: catchUpData } = await supabase
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq('conversation_id', conversationId)
      .or(`created_at.gt.${newestConfirmed.createdAt},and(created_at.eq.${newestConfirmed.createdAt},id.gt.${newestConfirmed.id})`)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(MAX_CATCHUP_LOAD);
    const catchUpRows = (catchUpData as MessageRow[]) ?? [];

    const onScreenIds = current.filter((m) => m.status !== 'sending' && m.status !== 'failed').map((m) => m.id);
    let refreshedRows: MessageRow[] = catchUpRows;
    if (onScreenIds.length > 0) {
      const { data: refreshData } = await supabase.from('messages').select(MESSAGE_SELECT).in('id', onScreenIds);
      const byId = new Map(refreshedRows.map((r) => [r.id, r]));
      for (const row of (refreshData as MessageRow[]) ?? []) byId.set(row.id, row);
      refreshedRows = Array.from(byId.values());
    }

    if (refreshedRows.length > 0) {
      const reactions = await fetchReactionsFor(refreshedRows);
      setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const row of refreshedRows) {
          const built = rowToMessage(row);
          built.reactions = reactions.filter((r) => r.message_id === row.id).map((r) => ({ userId: r.user_id, reaction: r.reaction }));
          byId.set(row.id, built);
        }
        return sortDesc(Array.from(byId.values()));
      });
      if (catchUpRows.some((r) => r.sender_id !== meId)) scheduleMarkRead();
    }

    const { data: participants } = await supabase
      .from('conversation_participants')
      .select('user_id, last_read_at')
      .eq('conversation_id', conversationId);
    const peer = (participants as ParticipantRow[] | null)?.find((p) => p.user_id !== meId)?.last_read_at ?? null;
    setPeerLastReadAt(peer);
  }, [conversationId, meId, scheduleMarkRead]);

  useEffect(() => {
    if (!conversationId || !meId) return;
    let cancelled = false;
    hasConnectedOnceRef.current = false;
    setMessages([]);
    setHasMore(true);
    setTypingUser(false);
    setPresence({ online: false, lastActive: null });
    setPeerLastReadAt(null);
    setInitialUnreadCount(0);
    setInitializing(true);

    const channel = supabase.channel(`chat:${conversationId}`, {
      config: { broadcast: { self: false }, presence: { key: meId } },
    });
    channelRef.current = channel;

    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        const row = payload.new as MessageRow;
        upsertMessage(rowToMessage(row));
        if (row.sender_id !== meId) scheduleMarkRead();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        upsertMessage(rowToMessage(payload.new as MessageRow));
      })
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as ParticipantRow;
          if (row.user_id !== meId) setPeerLastReadAt(row.last_read_at);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = (payload.new as ReactionRow | null) ?? (payload.old as ReactionRow | null);
          if (!row || !messagesRef.current.some((m) => m.id === row.message_id)) return;
          if (payload.eventType === 'DELETE') {
            setMessages((prev) => removeReaction(prev, row.message_id, row.user_id));
          } else {
            const newRow = payload.new as ReactionRow;
            setMessages((prev) => mergeReaction(prev, newRow.message_id, newRow.user_id, newRow.reaction));
          }
        }
      )
      .on('broadcast', { event: 'typing' }, (payload) => {
        const data = payload.payload as { userId: string; typing: boolean };
        if (!otherUserId || data.userId !== otherUserId) return;
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        if (data.typing) {
          setTypingUser(true);
          typingTimeoutRef.current = setTimeout(() => setTypingUser(false), TYPING_TIMEOUT_MS);
        } else {
          setTypingUser(false);
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channelRef.current?.presenceState<{ online: boolean }>() ?? {};
        const otherPresence = otherUserId ? state[otherUserId] : undefined;
        setPresence((prev) => ({ online: !!otherPresence && otherPresence.length > 0, lastActive: prev.lastActive }));
      });

    channel.subscribe(async (status) => {
      if (cancelled) return;
      if (status === 'SUBSCRIBED') {
        channel.track({ online: true, lastActive: new Date().toISOString() }).catch(() => {});
        if (!hasConnectedOnceRef.current) {
          hasConnectedOnceRef.current = true;
          loadInitial();
        } else {
          // The channel dropped (network loss, backgrounding, etc.) and
          // supabase-js has silently re-subscribed us — resync instead of
          // re-running loadInitial, which would blow away pagination history
          // and any in-flight optimistic messages.
          resyncAfterReconnect();
        }
      } else if (__DEV__ && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
        console.log('[chat] realtime channel', status, '— will resync on reconnect');
      }
    });

    const appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') refetchNewest();
    });

    return () => {
      cancelled = true;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
      appStateSub.remove();
      channel.untrack().catch(() => {});
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // loadInitial/refetchNewest/resyncAfterReconnect/scheduleMarkRead/upsertMessage
    // close over conversationId/meId already and are re-created together with
    // this effect, so they're intentionally left out of the dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, meId, otherUserId]);

  const sendTyping = useCallback((typing: boolean) => {
    if (!channelRef.current) return;
    if (typing) {
      const now = Date.now();
      if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
      lastTypingSentRef.current = now;
    } else {
      lastTypingSentRef.current = 0;
    }
    channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { userId: meId, typing } });
  }, [meId]);

  const sendMessage = useCallback(
    async (input: { text?: string; images?: string[]; imageKeys?: string[]; replyToId?: string | null }) => {
      if (!conversationId || !meId) return;
      const text = input.text?.trim() || null;
      const images = input.images ?? [];
      const imageKeys = input.imageKeys ?? [];
      if (!text && images.length === 0) return;

      const id = tempId();
      const optimistic: ChatMessage = {
        id,
        conversationId,
        senderId: meId,
        text,
        images,
        imageKeys,
        replyToId: input.replyToId ?? null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        status: 'sending',
        reactions: [],
      };
      setMessages((prev) => [optimistic, ...prev]);
      sendTyping(false);

      const { data, error } = await supabase
        .from('messages')
        .insert({ conversation_id: conversationId, sender_id: meId, text, images, image_keys: imageKeys, reply_to_id: input.replyToId ?? null })
        .select(MESSAGE_SELECT)
        .single();

      if (error || !data) {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'failed' } : m)));
        return;
      }
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== id);
        const real = rowToMessage(data as MessageRow);
        if (withoutTemp.some((m) => m.id === real.id)) return withoutTemp;
        return sortDesc([real, ...withoutTemp]);
      });
    },
    [conversationId, meId, sendTyping]
  );

  const retrySend = useCallback(
    (failedId: string) => {
      const failed = messagesRef.current.find((m) => m.id === failedId);
      if (!failed) return;
      setMessages((prev) => prev.filter((m) => m.id !== failedId));
      sendMessage({ text: failed.text ?? undefined, images: failed.images, imageKeys: failed.imageKeys, replyToId: failed.replyToId });
    },
    [sendMessage]
  );

  const dismissFailed = useCallback((failedId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== failedId));
  }, []);

  const editMessage = useCallback(async (id: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const original = messagesRef.current.find((m) => m.id === id);
    if (!original) return;
    const originalText = original.text;
    const originalEditedAt = original.editedAt;

    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: trimmed, editedAt: new Date().toISOString() } : m)));
    const { error } = await supabase.rpc('edit_message', { p_message_id: id, p_text: trimmed });
    if (error) {
      // Restore exactly the fields this action changed — not a full snapshot
      // replace — so any reaction/read-state updates that landed in the
      // meantime (via realtime) aren't clobbered by the rollback.
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: originalText, editedAt: originalEditedAt } : m)));
      showSnackbar(t('chat.editFailed'));
    }
  }, []);

  const deleteMessage = useCallback(async (id: string) => {
    const original = messagesRef.current.find((m) => m.id === id);
    if (!original) return;
    const originalText = original.text;
    const originalImages = original.images;
    const originalImageKeys = original.imageKeys;
    const originalDeletedAt = original.deletedAt;

    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, text: null, images: [], imageKeys: [], deletedAt: new Date().toISOString() } : m))
    );
    const { error } = await supabase.rpc('delete_message', { p_message_id: id });
    if (error) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, text: originalText, images: originalImages, imageKeys: originalImageKeys, deletedAt: originalDeletedAt } : m
        )
      );
      showSnackbar(t('chat.deleteFailed'));
    }
  }, []);

  const toggleReaction = useCallback(
    async (messageId: string, reaction: ReactionType) => {
      if (!meId) return;
      const msg = messagesRef.current.find((m) => m.id === messageId);
      const mine = msg?.reactions.find((r) => r.userId === meId);

      if (mine?.reaction === reaction) {
        setMessages((prev) => removeReaction(prev, messageId, meId));
        await supabase.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', meId);
        return;
      }

      setMessages((prev) => mergeReaction(prev, messageId, meId, reaction));
      await supabase.from('message_reactions').upsert({ message_id: messageId, user_id: meId, reaction }, { onConflict: 'message_id,user_id' });
    },
    [meId]
  );

  return {
    messages,
    initializing,
    hasMore,
    loadingOlder,
    loadOlder,
    typingUser,
    presence,
    peerLastReadAt,
    initialUnreadCount,
    sendMessage,
    retrySend,
    dismissFailed,
    editMessage,
    deleteMessage,
    toggleReaction,
    sendTyping,
  };
}
