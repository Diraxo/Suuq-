import { create } from 'zustand';
import { accountPerson } from '@/lib/profileIdentity';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import i18n from '@/lib/i18n';

// Chat-list row data — single source of truth for both the chat list screen
// and the tab unread badge (store/chatUnread.ts). Same
// module-level-realtime-channel idiom as store/notifications.ts / store/follow.ts:
// full reload on any relevant change rather than hand-rolled per-row patching —
// two lightweight queries per reload is cheap enough at this app's scale.

export type ChatListRow = {
  id: string;
  otherId: string;
  otherName: string;
  otherAvatar: string;
  /** last_seen_at heartbeat heuristic ("active somewhere in the app
   *  recently") — NOT the same thing as the realtime in-conversation
   *  presence app/chat/[id].tsx's useConversationChannel() tracks (which
   *  means "has this exact chat open right now"). Intentionally coarser
   *  here since there's no open channel per chat-list row to get real
   *  presence from. */
  otherOnline: boolean;
  lastMessage: string;
  lastMessageAt: number;
  unread: number;
  listing: { id: string; title: string; image: string | null } | null;
};

const CONVERSATION_SELECT =
  'id, listing_id, buyer_id, seller_id, last_message, last_message_at, created_at,' +
  ' listing:listings(id,title,images),' +
  ' buyer:profiles!conversations_buyer_id_fkey(id,full_name,avatar_url,last_seen_at),' +
  ' seller:profiles!conversations_seller_id_fkey(id,full_name,avatar_url,last_seen_at)';

type ProfileLite = { id: string; full_name: string | null; avatar_url: string | null; active_mode?: string | null; business_name?: string | null; business_logo_url?: string | null; last_seen_at: string | null };

type ConversationRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  last_message: string | null;
  last_message_at: string | null;
  created_at: string;
  listing: { id: string; title: string; images: string[] } | null;
  buyer: ProfileLite | null;
  seller: ProfileLite | null;
};

const ONLINE_WINDOW_MS = 90_000;

function rowToChatRow(row: ConversationRow, meId: string, unread: number): ChatListRow {
  const other = row.buyer_id === meId ? row.seller : row.buyer;
  const shown = accountPerson(other);
  const lastSeenAt = other?.last_seen_at ? new Date(other.last_seen_at).getTime() : 0;
  return {
    id: row.id,
    otherId: other?.id ?? '',
    otherName: shown.name ?? i18n.t('profile.defaultUserName'),
    otherAvatar: shown.avatarUrl ?? `https://picsum.photos/seed/${other?.id ?? row.id}/200/200`,
    otherOnline: lastSeenAt > 0 && Date.now() - lastSeenAt < ONLINE_WINDOW_MS,
    lastMessage: row.last_message || i18n.t('chats.noMessagesYet'),
    lastMessageAt: new Date(row.last_message_at ?? row.created_at).getTime(),
    unread,
    listing: row.listing ? { id: row.listing.id, title: row.listing.title, image: row.listing.images?.[0] ?? null } : null,
  };
}

type ChatConversationsState = {
  rows: ChatListRow[] | null;
  loadError: boolean;
  load: () => Promise<void>;
  reset: () => void;
};

export const useChatConversationsStore = create<ChatConversationsState>((set, get) => ({
  rows: null,
  loadError: false,

  load: async () => {
    const meId = useAuthStore.getState().session?.user.id;
    if (!meId) {
      set({ rows: [], loadError: false });
      return;
    }
    try {
      const [{ data: convRows, error }, { data: unreadRows }] = await Promise.all([
        supabase.from('conversations').select(CONVERSATION_SELECT).order('last_message_at', { ascending: false, nullsFirst: false }),
        supabase.rpc('get_conversation_unread_counts'),
      ]);
      if (error) throw error;

      const unreadMap = new Map<string, number>((unreadRows ?? []).map((r: { conversation_id: string; unread_count: number }) => [r.conversation_id, Number(r.unread_count)]));
      const rows = ((convRows as unknown as ConversationRow[]) ?? [])
        .map((row) => rowToChatRow(row, meId, unreadMap.get(row.id) ?? 0))
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt);

      set({ rows, loadError: false });
    } catch (err) {
      if (__DEV__) console.log('[chatConversations] failed to load:', err);
      set((s) => ({ loadError: true, rows: s.rows ?? [] }));
    }
  },

  reset: () => set({ rows: null, loadError: false }),
}));

let chatListChannel: RealtimeChannel | null = null;
let lastUserId: string | null = null;

// Keyed on profile.id, not session.user.id — see store/myListings.ts for why.
useAuthStore.subscribe((state) => {
  const uid = state.profile?.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;

  if (chatListChannel) {
    supabase.removeChannel(chatListChannel);
    chatListChannel = null;
  }

  if (!uid) {
    useChatConversationsStore.getState().reset();
    return;
  }

  useChatConversationsStore.getState().load();
  chatListChannel = supabase
    .channel(`chat-list-${uid}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => useChatConversationsStore.getState().load())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () => useChatConversationsStore.getState().load())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants' }, () => useChatConversationsStore.getState().load())
    .subscribe();
});

/** Shared cap so the tab badge and per-conversation row badges render counts identically. */
export function formatUnreadCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}
