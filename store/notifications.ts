import { create } from 'zustand';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { push, qaLog } from '@/lib/push';
import i18n from '@/lib/i18n';
import { localizeServerNotification } from '@/lib/notificationText';

export type Notif = {
  id: string;
  icon: string;
  title: string;
  body: string;
  time: string;
  unread: boolean;
  /** notifications.type — same vocabulary lib/push.ts's navigateForPush() switches on. */
  type: string | null;
  /** notifications.data — e.g. { listingId }, { conversationId } — passed straight into navigateForPush(). */
  data: Record<string, string> | null;
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return i18n.t('notifications.justNow');
  if (mins < 60) return i18n.t('notifications.minAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return i18n.t('time.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days === 1) return i18n.t('time.yesterday');
  return i18n.t('time.daysAgo', { count: days });
}

type NotifStore = {
  notifs: Notif[];
  hasHydrated: boolean;
  unreadCount: () => number;
  markAllRead: () => void;
  markOneRead: (id: string) => void;
  load: () => Promise<void>;
  remove: (id: string) => void;
  /** Dev QA's "reset" affordance — re-fetches from Supabase rather than restoring hardcoded mocks. */
  restoreDefaults: () => void;
  reset: () => void;
};

export const useNotifStore = create<NotifStore>((set, get) => ({
  notifs: [],
  hasHydrated: false,
  unreadCount: () => get().notifs.filter((n) => n.unread).length,
  markAllRead: () => {
    const session = useAuthStore.getState().session;
    const hadUnread = get().notifs.some((n) => n.unread);
    set((s) => ({ notifs: s.notifs.map((n) => ({ ...n, unread: false })) }));
    push.setBadge(0);
    if (session && hadUnread) {
      supabase.from('notifications').update({ read: true }).eq('user_id', session.user.id).eq('read', false).then(() => {});
    }
  },
  markOneRead: (id) => {
    const session = useAuthStore.getState().session;
    set((s) => ({ notifs: s.notifs.map((n) => (n.id === id ? { ...n, unread: false } : n)) }));
    push.setBadge(get().notifs.filter((n) => n.unread).length);
    if (session) {
      supabase.from('notifications').update({ read: true }).eq('id', id).eq('user_id', session.user.id).then(() => {});
    }
  },
  load: async () => {
    const session = useAuthStore.getState().session;
    if (!session) {
      set({ notifs: [], hasHydrated: true });
      return;
    }
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });
    const notifs: Notif[] = (data ?? []).map((row) => {
      // Verification / moderation / report-outcome rows are written by the database in English; show them in the
      // reader's language (unknown kinds keep the server text).
      const text = localizeServerNotification(row, { t: (k) => i18n.t(k), exists: (k) => i18n.exists(k) });
      return {
      id: row.id,
      icon: 'notifications-outline',
      title: text.title,
      body: text.body,
      time: timeAgo(row.created_at),
      unread: !row.read,
      type: row.type ?? null,
      data: row.data ?? null,
      };
    });
    set({ notifs, hasHydrated: true });
    push.setBadge(notifs.filter((n) => n.unread).length);
  },
  remove: (id) => {
    const session = useAuthStore.getState().session;
    set((s) => ({ notifs: s.notifs.filter((n) => n.id !== id) }));
    push.setBadge(get().notifs.filter((n) => n.unread).length);
    if (session) {
      supabase.from('notifications').delete().eq('id', id).eq('user_id', session.user.id).then(() => {});
    }
  },
  restoreDefaults: () => {
    get().load();
  },
  reset: () => {
    set({ notifs: [], hasHydrated: false });
    push.setBadge(0);
  },
}));

let notifChannel: RealtimeChannel | null = null;

function subscribeRealtime(userId: string) {
  if (notifChannel) supabase.removeChannel(notifChannel);
  notifChannel = supabase
    .channel(`notifications-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
      qaLog('notification stored', { event: payload.eventType, id: (payload.new as { id?: string })?.id });
      // A staff verification decision changes profiles.verified_at; re-read the profile so the owner's own badge
      // updates immediately instead of waiting for the next app start.
      if (payload.eventType === 'INSERT' && (payload.new as { type?: string })?.type === 'verification') {
        void useAuthStore.getState().refreshProfile();
      }
      useNotifStore.getState().load();
    })
    .subscribe();
}

let lastUserId: string | null = null;
// Keyed on profile.id, not session.user.id — see store/myListings.ts for why.
useAuthStore.subscribe((state) => {
  const uid = state.profile?.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;
  if (uid) {
    useNotifStore.getState().load();
    subscribeRealtime(uid);
  } else {
    useNotifStore.getState().reset();
    if (notifChannel) supabase.removeChannel(notifChannel);
    notifChannel = null;
  }
});
