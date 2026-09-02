// Real chat wiring — same tables/RPCs/RLS as store/chatConversations.ts +
// hooks/useConversationChannel.ts on mobile (native Supabase Realtime, not
// polling). Conversations/messages are only ever created/edited/deleted via
// SECURITY DEFINER RPCs (find_or_create_conversation, edit_message,
// delete_message, mark_conversation_read) — direct insert/update against
// those tables is rejected by RLS by design.
import { supabase } from '@/lib/supabase';
import { Conversation, Message } from '@/lib/types';

const CONVERSATION_SELECT =
  'id, listing_id, buyer_id, seller_id, last_message, last_message_at, created_at,' +
  ' listing:listings(id,title,price,currency,images),' +
  ' buyer:profiles!conversations_buyer_id_fkey(id,full_name,avatar_url,phone,last_seen_at),' +
  ' seller:profiles!conversations_seller_id_fkey(id,full_name,avatar_url,phone,last_seen_at)';

const MESSAGE_SELECT = 'id, conversation_id, sender_id, text, images, reply_to_id, edited_at, deleted_at, created_at';

type ProfileLite = { id: string; full_name: string | null; avatar_url: string | null; phone: string | null; last_seen_at: string | null };

type ConversationRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  last_message: string | null;
  last_message_at: string | null;
  created_at: string;
  listing: { id: string; title: string; price: number | string; currency: string; images: string[] | null } | null;
  buyer: ProfileLite | null;
  seller: ProfileLite | null;
};

function rowToConversation(row: ConversationRow, meId: string, unread: number): Conversation | null {
  if (!row.listing) return null;
  const otherProfile = row.buyer_id === meId ? row.seller : row.buyer;
  return {
    id: row.id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    listing: {
      id: row.listing.id,
      title: row.listing.title,
      price: Number(row.listing.price),
      currency: row.listing.currency,
      images: row.listing.images ?? [],
    },
    withUser: {
      id: otherProfile?.id ?? '',
      name: otherProfile?.full_name ?? 'SUUQIYE user',
      avatar: otherProfile?.avatar_url ?? `https://picsum.photos/seed/${otherProfile?.id ?? 'user'}/200/200`,
      phone: otherProfile?.phone ?? null,
      lastSeenAt: otherProfile?.last_seen_at ?? null,
    },
    lastMessage: row.last_message ?? '',
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at).toLocaleString() : '',
    unread,
    messages: [],
  };
}

export async function listConversations(meId: string): Promise<Conversation[]> {
  const [{ data: rows, error }, { data: unreadRows }] = await Promise.all([
    supabase.from('conversations').select(CONVERSATION_SELECT).order('last_message_at', { ascending: false, nullsFirst: false }),
    supabase.rpc('get_conversation_unread_counts'),
  ]);
  if (error || !rows) return [];
  const unreadMap = new Map<string, number>((unreadRows ?? []).map((r: { conversation_id: string; unread_count: number }) => [r.conversation_id, r.unread_count]));
  return (rows as unknown as ConversationRow[])
    .map((row) => rowToConversation(row, meId, unreadMap.get(row.id) ?? 0))
    .filter((c): c is Conversation => !!c);
}

export async function getConversation(id: string, meId: string): Promise<Conversation | undefined> {
  const { data, error } = await supabase.from('conversations').select(CONVERSATION_SELECT).eq('id', id).maybeSingle();
  if (error || !data) return undefined;
  return rowToConversation(data as unknown as ConversationRow, meId, 0) ?? undefined;
}

// SECURITY DEFINER RPC — creates the conversation (and both participant
// rows) if one doesn't already exist for this listing+buyer+seller triple.
export async function startConversation(listingId: string): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase.rpc('find_or_create_conversation', { p_listing_id: listingId });
  if (error || !data) return { error: error?.message ?? 'Could not start conversation.' };
  return { id: (data as { id: string }).id };
}

type MessageRow = {
  id: string;
  sender_id: string;
  text: string | null;
  created_at: string;
  deleted_at: string | null;
};

export async function listMessages(conversationId: string, meId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as MessageRow[])
    .filter((r) => !r.deleted_at)
    .map((r) => ({
      id: r.id,
      conversationId,
      fromMe: r.sender_id === meId,
      text: r.text ?? '',
      sentAt: new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }));
}

export async function sendMessage(conversationId: string, senderId: string, text: string): Promise<Message | null> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, text })
    .select(MESSAGE_SELECT)
    .single();
  if (error || !data) return null;
  return {
    id: data.id,
    conversationId,
    fromMe: true,
    text: data.text ?? '',
    sentAt: new Date(data.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

export async function markConversationRead(conversationId: string): Promise<void> {
  await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
}

// supabase.channel(topic) returns the *same* channel object for a repeated
// topic string instead of opening a second connection, and Supabase throws
// if you .on() a channel that's already been .subscribe()'d. Header and the
// chat list page both want the inbox channel for the same user at once, so
// each topic gets one real channel shared via ref-counted listeners.
const sharedChannels = new Map<string, { channel: ReturnType<typeof supabase.channel>; listeners: Set<() => void> }>();

function subscribeShared(topic: string, onChange: () => void, build: (channel: ReturnType<typeof supabase.channel>, dispatch: () => void) => ReturnType<typeof supabase.channel>) {
  let entry = sharedChannels.get(topic);
  if (!entry) {
    const listeners = new Set<() => void>();
    const dispatch = () => listeners.forEach((l) => l());
    const channel = build(supabase.channel(topic), dispatch);
    channel.subscribe();
    entry = { channel, listeners };
    sharedChannels.set(topic, entry);
  }
  entry.listeners.add(onChange);
  return () => {
    const current = sharedChannels.get(topic);
    if (!current) return;
    current.listeners.delete(onChange);
    if (current.listeners.size === 0) {
      supabase.removeChannel(current.channel);
      sharedChannels.delete(topic);
    }
  };
}

// One realtime channel per open thread — new messages only (matches what
// the Phase 1 chat UI renders; typing/presence/reactions aren't built yet).
export function subscribeToConversation(conversationId: string, onInsert: () => void) {
  return subscribeShared(`chat:${conversationId}`, onInsert, (channel, dispatch) =>
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, dispatch)
  );
}

// Powers the chat list + Header unread badge — new messages in any of the
// user's conversations.
export function subscribeToInbox(userId: string, onChange: () => void) {
  return subscribeShared(`chat-list-${userId}`, onChange, (channel, dispatch) =>
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, dispatch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants' }, dispatch)
  );
}
