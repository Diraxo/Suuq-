// Real `notifications` table reads, mirroring store/notifications.ts on
// mobile. There is no client insert policy — every row is server-generated
// (favorites/follow/review/offer/message/price-drop triggers and RPCs), so
// this module is read + mark-read + delete only.
import { supabase } from '@/lib/supabase';
import { Notif, NotifType } from '@/lib/types';

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  type: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
};

// Maps the backend's full type vocabulary onto the 6 icon buckets the
// Phase 1 UI already has (see notifications/page.tsx's TYPE_ICON map).
function toDisplayType(rawType: string | null): NotifType {
  switch (rawType) {
    case 'favorite':
      return 'favorite';
    case 'follow':
      return 'follow';
    case 'message':
      return 'message';
    case 'offer_new':
    case 'offer_accepted':
    case 'offer_rejected':
    case 'offer_countered':
    case 'offer_cancelled':
    case 'offer_expired':
      return 'offer';
    case 'listing_sold':
    case 'price_drop':
      return 'listing';
    case 'moderation':
      return 'moderation';
    case 'verification':
      return 'verification';
    case 'report_result':
    case 'report_staff':
    case 'support_staff':
    case 'listing_staff':
    case 'user_staff':
    case 'activity_staff':
      return 'report';
    default:
      return 'system';
  }
}

function rowToNotif(row: NotificationRow): Notif {
  return {
    id: row.id,
    type: toDisplayType(row.type),
    rawType: row.type,
    title: row.title,
    body: row.body,
    time: new Date(row.created_at).toLocaleString(),
    unread: !row.read,
    data: row.data ?? undefined,
  };
}

export async function listNotifications(userId: string): Promise<Notif[]> {
  const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as NotificationRow[]).map(rowToNotif);
}

export async function markAllRead(userId: string): Promise<void> {
  await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false);
}

export async function markRead(userId: string, id: string): Promise<void> {
  await supabase.from('notifications').update({ read: true }).eq('id', id).eq('user_id', userId);
}

export async function dismissNotification(userId: string, id: string): Promise<void> {
  await supabase.from('notifications').delete().eq('id', id).eq('user_id', userId);
}

// Unread staff alerts per type, for the admin nav badges.
export async function getStaffUnreadByType(userId: string): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('notifications')
    .select('type')
    .eq('user_id', userId)
    .eq('read', false)
    .in('type', ['report_staff', 'support_staff', 'listing_staff', 'user_staff', 'activity_staff']);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { type: string }[]) out[r.type] = (out[r.type] ?? 0) + 1;
  return out;
}

export async function markTypeRead(userId: string, type: string): Promise<void> {
  await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('type', type).eq('read', false);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('read', false);
  return count ?? 0;
}

// supabase.channel(topic) returns the *same* channel object for a repeated
// topic string instead of opening a second connection, and Supabase throws
// if you .on() a channel that's already been .subscribe()'d. Header and the
// notifications page both want this channel for the same user at once, so
// the topic gets one real channel shared via ref-counted listeners (mirrors
// subscribeShared in services/chat.ts).
const sharedChannels = new Map<string, { channel: ReturnType<typeof supabase.channel>; listeners: Set<() => void> }>();

export function subscribeToNotifications(userId: string, onChange: () => void) {
  const topic = `notifications-${userId}`;
  let entry = sharedChannels.get(topic);
  if (!entry) {
    const listeners = new Set<() => void>();
    const dispatch = () => listeners.forEach((l) => l());
    const channel = supabase
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, dispatch)
      .subscribe();
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
