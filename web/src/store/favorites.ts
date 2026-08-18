'use client';

import { create } from 'zustand';
import { useAuthStore } from './auth';
import { listFavoriteIds, addFavorite, removeFavorite } from '@/services/favorites';

type FavoritesState = {
  ids: string[];
  hasHydrated: boolean;
  isFavorited: (id: string) => boolean;
  load: () => Promise<void>;
  toggle: (id: string) => void;
  add: (id: string) => void;
  reset: () => void;
};

// Real Supabase-backed favorites (replaces the Phase 1 localStorage-only
// store) — synced with the same `favorites` table the mobile app reads/
// writes, so favoriting on web shows up in the app and vice versa.
// Optimistic updates (same pattern as store/favorites.ts on mobile): the UI
// flips instantly, the Supabase call happens in the background, and only
// rolls back on failure.
export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  ids: [],
  hasHydrated: false,

  isFavorited: (id) => get().ids.includes(id),

  load: async () => {
    const userId = useAuthStore.getState().session?.user.id;
    if (!userId) {
      set({ ids: [], hasHydrated: true });
      return;
    }
    const serverIds = await listFavoriteIds(userId);
    // Merge rather than overwrite: this fires from the auth-state subscription
    // below at the same moment PendingActionRunner may be completing a
    // favorite that was queued before sign-in (see SignInModal). If that
    // optimistic add's server insert hasn't committed yet when this fetch
    // resolves, an overwrite would drop it from `ids` and the heart would
    // un-favorite itself until a manual refresh. Whatever is already in
    // `ids` at this point can only be this session's own optimistic state
    // (reset() clears it on sign-out), so merging is always safe here.
    set((s) => ({ ids: Array.from(new Set([...serverIds, ...s.ids])), hasHydrated: true }));
  },

  toggle: (id) => {
    const userId = useAuthStore.getState().session?.user.id;
    if (!userId) return; // gated by requireAuth() at every call site
    const wasFavorited = get().ids.includes(id);
    set((s) => ({ ids: wasFavorited ? s.ids.filter((x) => x !== id) : [...s.ids, id] }));
    const ok = wasFavorited ? removeFavorite(userId, id) : addFavorite(userId, id);
    ok.then((success) => {
      if (success) return;
      // Roll back on failure (e.g. rate limit, network error).
      set((s) => ({ ids: wasFavorited ? [...s.ids, id] : s.ids.filter((x) => x !== id) }));
    });
  },

  add: (id) => {
    if (get().ids.includes(id)) return;
    const userId = useAuthStore.getState().session?.user.id;
    if (!userId) return;
    set((s) => ({ ids: [...s.ids, id] }));
    addFavorite(userId, id).then((success) => {
      if (success) return;
      set((s) => ({ ids: s.ids.filter((x) => x !== id) }));
    });
  },

  reset: () => set({ ids: [], hasHydrated: false }),
}));

let lastFavUserId: string | null = null;
useAuthStore.subscribe((state) => {
  const uid = state.session?.user.id ?? null;
  if (uid === lastFavUserId) return;
  lastFavUserId = uid;
  if (uid) useFavoritesStore.getState().load();
  else useFavoritesStore.getState().reset();
});
