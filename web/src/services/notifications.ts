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
    default:
      return 'system';
  }
}

function rowToNotif(row: NotificationRow): Notif {
  return {
    id: row.id,
    type: toDisplayType(row.type),
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

export async function getUnreadCount(userId: string): Promise<number> {
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('read', false);
  return count ?? 0;
}

export function subscribeToNotifications(userId: string, onChange: () => void) {
  const channel = supabase
    .channel(`notifications-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
