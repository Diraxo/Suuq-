import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

export type SavedAddress = { id: string; label: string; address: string; city: string | null };

type SavedAddressesStore = {
  addresses: SavedAddress[];
  hasHydrated: boolean;
  load: () => Promise<void>;
  add: (input: { label: string; address: string; city?: string }) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  reset: () => void;
};

export const useSavedAddressesStore = create<SavedAddressesStore>((set, get) => ({
  addresses: [],
  hasHydrated: false,

  load: async () => {
    const uid = useAuthStore.getState().session?.user.id;
    if (!uid) {
      set({ addresses: [], hasHydrated: true });
      return;
    }
    const { data, error } = await supabase.from('saved_addresses').select('*').eq('user_id', uid).order('created_at', { ascending: false });
    // A failed read keeps what is already shown; it must not wipe the list or mark it loaded.
    if (error) return;
    const addresses = (data ?? []).map((row: any): SavedAddress => ({ id: row.id, label: row.label, address: row.address, city: row.city }));
    set({ addresses, hasHydrated: true });
  },

  add: async ({ label, address, city }) => {
    const uid = useAuthStore.getState().session?.user.id;
    if (!uid) return false;
    const { error } = await supabase.from('saved_addresses').insert({ user_id: uid, label, address, city: city ?? null });
    if (error) return false;
    await get().load();
    return true;
  },

  remove: async (id) => {
    const before = get().addresses;
    set((s) => ({ addresses: s.addresses.filter((a) => a.id !== id) }));
    const { error } = await supabase.from('saved_addresses').delete().eq('id', id);
    if (error) {
      set({ addresses: before });
      return false;
    }
    return true;
  },

  reset: () => set({ addresses: [], hasHydrated: false }),
}));

let lastUserId: string | null = null;
// Keyed on profile.id, not session.user.id — see store/myListings.ts for why.
useAuthStore.subscribe((state) => {
  const uid = state.profile?.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;
  if (uid) useSavedAddressesStore.getState().load();
  else useSavedAddressesStore.getState().reset();
});
