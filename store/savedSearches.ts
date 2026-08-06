import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

export type SavedSearch = { id: string; query: string; filter: string };

type SavedSearchRow = { id: string; search_data: { query: string; filter: string } };

type SavedSearchStore = {
  searches: SavedSearch[];
  hasHydrated: boolean;
  load: () => Promise<void>;
  add: (query: string, filter: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reset: () => void;
};

export const useSavedSearchStore = create<SavedSearchStore>((set, get) => ({
  searches: [],
  hasHydrated: false,

  load: async () => {
    const session = useAuthStore.getState().session;
    if (!session) {
      set({ searches: [], hasHydrated: true });
      return;
    }
    const { data } = await supabase
      .from('saved_searches')
      .select('id, search_data')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });
    const rows = (data ?? []) as SavedSearchRow[];
    set({
      searches: rows.map((r) => ({ id: r.id, query: r.search_data.query, filter: r.search_data.filter })),
      hasHydrated: true,
    });
  },

  add: async (query, filter) => {
    const session = useAuthStore.getState().session;
    if (!session) return;
    const { data, error } = await supabase
      .from('saved_searches')
      .insert({ user_id: session.user.id, search_data: { query, filter } })
      .select('id')
      .single();
    if (error || !data) return;
    set((s) => ({ searches: [{ id: data.id as string, query, filter }, ...s.searches] }));
  },

  remove: async (id) => {
    set((s) => ({ searches: s.searches.filter((x) => x.id !== id) }));
    await supabase.from('saved_searches').delete().eq('id', id);
  },

  reset: () => {
    get().load();
  },
}));

let lastUserId: string | null = null;
useAuthStore.subscribe((state) => {
  const uid = state.session?.user.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;
  if (uid) useSavedSearchStore.getState().load();
  else useSavedSearchStore.getState().reset();
});
