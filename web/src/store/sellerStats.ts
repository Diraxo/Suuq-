'use client';

import { create } from 'zustand';
import { useAuthStore } from './auth';
import { supabase } from '@/lib/supabase';
import { getSellerStats, SellerStats } from '@/services/profile';

const EMPTY_STATS: SellerStats = { listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 };

type SellerStatsState = {
  stats: SellerStats;
  hasHydrated: boolean;
  load: () => Promise<void>;
  reset: () => void;
};

// Pre-warmed the moment auth resolves, app-wide — same module-level
// useAuthStore.subscribe() pattern as store/favorites.ts, so seller stats
// are already loaded in the store by the time a user navigates to /profile
// instead of being fetched fresh on every mount (which flashed 0
// listings/followers/rating on every visit, not just first sign-in).
// Keyed on `profile?.id` rather than `session?.user.id`, mirroring mobile's
// store/reviews.ts / store/follow.ts / store/myListings.ts — those key off
// profile.id specifically because init() resolves session one tick before
// profile, and mobile's own comments call out keying on session as firing
// one tick too early. There's no functional difference for this particular
// query (getSellerStats only needs the user id, which is the same value
// either way), but matching mobile's pattern keeps this store consistent
// with prefetch stores added later that might depend on `profile` fields.
export const useSellerStatsStore = create<SellerStatsState>((set) => ({
  stats: EMPTY_STATS,
  hasHydrated: false,

  load: async () => {
    const userId = useAuthStore.getState().profile?.id;
    if (!userId) {
      set({ stats: EMPTY_STATS, hasHydrated: true });
      return;
    }
    const stats = await getSellerStats(userId);
    set({ stats, hasHydrated: true });
  },

  reset: () => set({ stats: EMPTY_STATS, hasHydrated: false }),
}));

let lastStatsUserId: string | null = null;
useAuthStore.subscribe((state) => {
  const uid = state.profile?.id ?? null;
  if (uid === lastStatsUserId) return;
  lastStatsUserId = uid;
  if (uid) useSellerStatsStore.getState().load();
  else useSellerStatsStore.getState().reset();
});

// Keeps the counts live: any change to this seller's listings (posted, sold, deleted), followers or reviews —
// from this device, the phone, or another buyer — reloads the numbers, and so does returning to the tab. Without
// this the web profile showed whatever it loaded at sign-in until a manual refresh.
let lastRealtimeUserId: string | null = null;
let statsChannel: ReturnType<typeof supabase.channel> | null = null;
let statsTimer: ReturnType<typeof setTimeout> | null = null;
const reloadSoon = () => {
  if (statsTimer) clearTimeout(statsTimer);
  statsTimer = setTimeout(() => void useSellerStatsStore.getState().load(), 250);
};
useAuthStore.subscribe((state) => {
  const uid = state.profile?.id ?? null;
  if (uid === lastRealtimeUserId) return;
  lastRealtimeUserId = uid;
  if (statsChannel) {
    supabase.removeChannel(statsChannel);
    statsChannel = null;
  }
  if (!uid) return;
  statsChannel = supabase
    .channel(`seller-stats-${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'listings', filter: `user_id=eq.${uid}` }, reloadSoon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'followers', filter: `following_id=eq.${uid}` }, reloadSoon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews', filter: `seller_id=eq.${uid}` }, reloadSoon)
    .subscribe();
});
if (typeof document !== 'undefined') {
  const refreshIfSignedIn = () => {
    if (useAuthStore.getState().profile) reloadSoon();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshIfSignedIn();
  });
  window.addEventListener('focus', refreshIfSignedIn);
  window.addEventListener('online', refreshIfSignedIn);
}
