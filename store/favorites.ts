import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { showSnackbar } from '@/lib/snackbar';

type FavoritesState = {
  favoritedIds: Set<string>;
  hasHydrated: boolean;
  isFavorited: (id: string) => boolean;
  toggle: (id: string) => void;
  load: () => Promise<void>;
  reset: () => void;
};

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favoritedIds: new Set(),
  hasHydrated: false,
  isFavorited: (id) => get().favoritedIds.has(id),
  toggle: (id) => {
    const session = useAuthStore.getState().session;
    if (!session) return;
    const wasFavorited = get().favoritedIds.has(id);

    set((state) => {
      const next = new Set(state.favoritedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { favoritedIds: next };
    });

    const write = wasFavorited
      ? supabase.from('favorites').delete().eq('user_id', session.user.id).eq('listing_id', id)
      : supabase.from('favorites').insert({ user_id: session.user.id, listing_id: id });

    write.then(({ error }) => {
      if (!error) return;
      // Roll back the optimistic toggle if the write failed.
      set((state) => {
        const next = new Set(state.favoritedIds);
        if (wasFavorited) next.add(id);
        else next.delete(id);
        return { favoritedIds: next };
      });
      showSnackbar('Could not update favorites. Check your connection and try again.');
    });
  },
  load: async () => {
    const session = useAuthStore.getState().session;
    if (!session) {
      set({ favoritedIds: new Set(), hasHydrated: true });
      return;
    }
    const { data } = await supabase.from('favorites').select('listing_id').eq('user_id', session.user.id);
    set({ favoritedIds: new Set((data ?? []).map((r) => r.listing_id as string)), hasHydrated: true });
  },
  reset: () => set({ favoritedIds: new Set(), hasHydrated: false }),
}));

let lastUserId: string | null = null;
useAuthStore.subscribe((state) => {
  const uid = state.session?.user.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;
  if (uid) useFavoritesStore.getState().load();
  else useFavoritesStore.getState().reset();
});
