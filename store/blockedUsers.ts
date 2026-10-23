import { create } from 'zustand';
import { accountPerson } from '@/lib/profileIdentity';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import i18n from '@/lib/i18n';

export type BlockedPerson = { id: string; name: string; avatar: string };

type BlockedUsersStore = {
  /** People I have blocked. */
  blocked: BlockedPerson[];
  /** Ids of people who have blocked me — the reverse direction, needed to
   *  enforce blocking both ways (hide each other, prevent contact either
   *  way) even though only the blocker's UI shows an "Unblock" button. */
  blockedByIds: string[];
  hasHydrated: boolean;
  /** Bumped after every completed block/unblock (database write done) so an open chat can refetch its "You blocked / unblocked" log. */
  version: number;
  load: () => Promise<void>;
  block: (userId: string) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
  reset: () => void;
};

export const useBlockedUsersStore = create<BlockedUsersStore>((set, get) => ({
  blocked: [],
  blockedByIds: [],
  hasHydrated: false,
  version: 0,

  load: async () => {
    const uid = useAuthStore.getState().session?.user.id;
    if (!uid) {
      set({ blocked: [], blockedByIds: [], hasHydrated: true });
      return;
    }
    const [{ data }, { data: blockedByData }] = await Promise.all([
      supabase.from('blocked_users').select('blocked:profiles!blocked_users_blocked_id_fkey(id,full_name,avatar_url)').eq('blocker_id', uid),
      supabase.from('blocked_users').select('blocker_id').eq('blocked_id', uid),
    ]);
    const blocked = ((data ?? []) as any[])
      .map((row) => row.blocked)
      .filter(Boolean)
      .map((p): BlockedPerson => ({ id: p.id, name: accountPerson(p).name ?? i18n.t('profile.defaultUserName'), avatar: accountPerson(p).avatarUrl ?? `https://picsum.photos/seed/${p.id}/200/200` }));
    const blockedByIds = ((blockedByData ?? []) as { blocker_id: string }[]).map((r) => r.blocker_id);
    set({ blocked, blockedByIds, hasHydrated: true });
  },

  block: async (userId) => {
    const uid = useAuthStore.getState().session?.user.id;
    if (!uid || uid === userId) return; // nobody can block themselves
    const { error } = await supabase.from('blocked_users').insert({ blocker_id: uid, blocked_id: userId });
    if (!error) {
      await get().load();
      set((s) => ({ version: s.version + 1 }));
    }
  },

  unblock: async (userId) => {
    const uid = useAuthStore.getState().session?.user.id;
    if (!uid) return;
    set((s) => ({ blocked: s.blocked.filter((b) => b.id !== userId) }));
    const { error } = await supabase.from('blocked_users').delete().eq('blocker_id', uid).eq('blocked_id', userId);
    if (error) await get().load(); // the optimistic removal didn't happen on the server — restore the truth
    set((s) => ({ version: s.version + 1 }));
  },

  reset: () => set({ blocked: [], blockedByIds: [], hasHydrated: false }),
}));

let lastUserId: string | null = null;
// Keyed on profile.id, not session.user.id — see store/myListings.ts for why.
useAuthStore.subscribe((state) => {
  const uid = state.profile?.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;
  if (uid) useBlockedUsersStore.getState().load();
  else useBlockedUsersStore.getState().reset();
});
