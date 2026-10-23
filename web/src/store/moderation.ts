import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { ACTIVE_ACCOUNT, AccountState, ModerationNotice, SupportCase, mergeNotice, rowToNotice } from '@/lib/moderationClient';
import { fetchAccountState, fetchCases, fetchNotices, markNoticeRead } from '@/lib/supportApi';

// The signed-in seller's moderation state: account restriction (suspended/banned + end date), notices from
// "Suuqiye Support Team" and support cases. Kept live over Supabase Realtime (RLS limits every subscription to
// the seller's own rows) and fully reloaded on every (re)connect, so a missed event, a duplicate or an
// out-of-order delivery can never leave it stale. Identical copy at web/src/store/moderation.ts.
type ModerationState = {
  account: AccountState;
  notices: ModerationNotice[];
  cases: SupportCase[];
  /** Bumps whenever a support message arrives, so an open case thread knows to reload. */
  messageNonce: number;
  hasLoaded: boolean;
  error: string | null;
  unreadCount: () => number;
  load: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  reset: () => void;
};

let loadGuard = 0;

export const useModerationStore = create<ModerationState>((set, get) => ({
  account: ACTIVE_ACCOUNT,
  notices: [],
  cases: [],
  messageNonce: 0,
  hasLoaded: false,
  error: null,
  unreadCount: () => get().notices.filter((n) => !n.readAt).length,

  load: async () => {
    const uid = useAuthStore.getState().session?.user.id;
    if (!uid) return get().reset();
    const ticket = ++loadGuard;
    try {
      const [account, notices, cases] = await Promise.all([fetchAccountState(), fetchNotices(), fetchCases()]);
      if (ticket !== loadGuard) return; // a newer load superseded this one
      set({ account, notices, cases, hasLoaded: true, error: null });
    } catch (e) {
      if (ticket !== loadGuard) return;
      set({ hasLoaded: true, error: e instanceof Error ? e.message : 'Could not load your notices.' });
    }
  },

  markRead: async (id) => {
    set((s) => ({ notices: s.notices.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)) }));
    await markNoticeRead(id);
  },

  reset: () => {
    loadGuard++;
    set({ account: ACTIVE_ACCOUNT, notices: [], cases: [], hasLoaded: false, error: null });
  },
}));

let channel: ReturnType<typeof supabase.channel> | null = null;
// removeChannel is async, and supabase.channel(topic) hands back the still-registered (already subscribed) channel for
// a topic it knows, so every subscription gets its own topic: re-subscribing can never reuse a dead one.
let channelSeq = 0;

function subscribe(userId: string) {
  if (channel) supabase.removeChannel(channel);
  const reload = () => void useModerationStore.getState().load();
  channel = supabase
    .channel(`moderation-${userId}-${++channelSeq}`)
    // A new notice appears instantly (and the account state is re-read: it may have just changed).
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'moderation_notices', filter: `user_id=eq.${userId}` }, (payload) => {
      useModerationStore.setState((s) => ({ notices: mergeNotice(s.notices, rowToNotice(payload.new as Record<string, any>)) }));
      reload();
    })
    // Every support message touches its case row (last_message_at / status), so one per-user, filtered subscription
    // on support_cases covers new replies - without a filter-less subscription on support_messages, which would make
    // Realtime evaluate RLS for every message from every user against every connected seller.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'support_cases', filter: `user_id=eq.${userId}` }, () => {
      useModerationStore.setState((s) => ({ messageNonce: s.messageNonce + 1 }));
      reload();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, reload)
    // SUBSCRIBED also fires after an automatic reconnect: whatever happened while offline is re-read in full.
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') reload();
    });
}

// Keyed on profile.id (not session.user.id) for the same reason as the other session-scoped stores: the session is
// set before the profile row finishes loading.
let lastUserId: string | null = null;
useAuthStore.subscribe((state) => {
  const uid = state.profile?.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;
  if (uid) {
    void useModerationStore.getState().load();
    subscribe(uid);
  } else {
    if (channel) supabase.removeChannel(channel);
    channel = null;
    useModerationStore.getState().reset();
  }
});
