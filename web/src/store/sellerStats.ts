'use client';

import { create } from 'zustand';
import { useAuthStore } from './auth';
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
