import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

type RecentlyViewedState = {
  viewedIds: string[];
  hasHydrated: boolean;
  addView: (id: string) => void;
  load: () => Promise<void>;
  reset: () => void;
};

const MAX_ITEMS = 30;
const GUEST_STORAGE_KEY = '@suuq/recentlyViewed';

async function readLocal(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(GUEST_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(ids: string[]) {
  AsyncStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(ids)).catch(() => {});
}

export const useRecentlyViewedStore = create<RecentlyViewedState>((set, get) => ({
  viewedIds: [],
  hasHydrated: false,
  addView: (id) => {
    const next = [id, ...get().viewedIds.filter((v) => v !== id)].slice(0, MAX_ITEMS);
    set({ viewedIds: next });
    const session = useAuthStore.getState().session;
    if (!session) {
      writeLocal(next);
      return;
    }
    supabase
      .from('recently_viewed')
      .upsert({ user_id: session.user.id, listing_id: id, viewed_at: new Date().toISOString() }, { onConflict: 'user_id,listing_id' })
      .then(() => {});
  },
  load: async () => {
    const session = useAuthStore.getState().session;
    if (!session) {
      const local = await readLocal();
      set({ viewedIds: local, hasHydrated: true });
      return;
    }
    const { data } = await supabase
      .from('recently_viewed')
      .select('listing_id')
      .eq('user_id', session.user.id)
      .order('viewed_at', { ascending: false })
      .limit(MAX_ITEMS);
    set({ viewedIds: (data ?? []).map((r) => r.listing_id as string), hasHydrated: true });
  },
  reset: () => set({ viewedIds: [], hasHydrated: false }),
}));

let lastUserId: string | null = null;
useAuthStore.subscribe((state) => {
  const uid = state.session?.user.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;
  if (uid) {
    // Merge any guest-local history into Supabase before loading from it, so
    // listings viewed before sign-in aren't lost.
    readLocal().then(async (local) => {
      if (local.length > 0) {
        await Promise.all(
          local.map((listingId) =>
            supabase
              .from('recently_viewed')
              .upsert({ user_id: uid, listing_id: listingId, viewed_at: new Date().toISOString() }, { onConflict: 'user_id,listing_id' })
          )
        );
        await AsyncStorage.removeItem(GUEST_STORAGE_KEY);
      }
      useRecentlyViewedStore.getState().load();
    });
  } else {
    useRecentlyViewedStore.getState().reset();
  }
});
