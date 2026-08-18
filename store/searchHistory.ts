import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

type SearchHistoryState = {
  queries: string[];
  hasHydrated: boolean;
  load: () => Promise<void>;
  record: (query: string) => void;
  clear: () => void;
  reset: () => void;
};

const MAX_ITEMS = 10;

export const useSearchHistoryStore = create<SearchHistoryState>((set, get) => ({
  queries: [],
  hasHydrated: false,

  load: async () => {
    const session = useAuthStore.getState().session;
    if (!session) {
      set({ queries: [], hasHydrated: true });
      return;
    }
    const { data } = await supabase
      .from('search_history')
      .select('query')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(MAX_ITEMS);
    set({ queries: (data ?? []).map((r) => r.query as string), hasHydrated: true });
  },

  // Fire-and-forget, like recentlyViewed.addView — a search query isn't
  // important enough to block the UI on, and a failed write just means the
  // query doesn't show up in history next time, not a broken feature.
  record: (query) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const session = useAuthStore.getState().session;
    if (!session) return;

    set((s) => ({ queries: [trimmed, ...s.queries.filter((q) => q.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_ITEMS) }));
    supabase
      .from('search_history')
      .upsert({ user_id: session.user.id, query: trimmed, created_at: new Date().toISOString() }, { onConflict: 'user_id,query' })
      .then(() => {});
  },

  clear: () => {
    set({ queries: [] });
    const session = useAuthStore.getState().session;
    if (!session) return;
    supabase.from('search_history').delete().eq('user_id', session.user.id).then(() => {});
  },

  reset: () => {
    get().load();
  },
}));

let lastUserId: string | null = null;
// Keyed on profile.id, not session.user.id — see store/myListings.ts for why.
useAuthStore.subscribe((state) => {
  const uid = state.profile?.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;
  if (uid) useSearchHistoryStore.getState().load();
  else useSearchHistoryStore.getState().reset();
});
