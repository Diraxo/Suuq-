'use client';

// Mirrors store/blockedUsers.ts on mobile exactly — same table, same
// "blocker_id"/"blocked_id" columns, same both-directions gating (people I
// blocked, and people who blocked me).
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

export type BlockedPerson = { id: string; name: string; avatar: string };

type BlockedUsersState = {
  blocked: BlockedPerson[];
  blockedByIds: string[];
  hasHydrated: boolean;
  load: () => Promise<void>;
  block: (userId: string) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
  reset: () => void;
};

export const useBlockedUsersStore = create<BlockedUsersState>((set, get) => ({
  blocked: [],
  blockedByIds: [],
  hasHydrated: false,

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
    const blocked = ((data ?? []) as unknown as { blocked: { id: string; full_name: string | null; avatar_url: string | null } | null }[])
      .map((row) => row.blocked)
      .filter((p): p is { id: string; full_name: string | null; avatar_url: string | null } => !!p)
      .map((p): BlockedPerson => ({ id: p.id, name: p.full_name ?? 'Fursad user', avatar: p.avatar_url ?? `https://picsum.photos/seed/${p.id}/200/200` }));
    const blockedByIds = ((blockedByData ?? []) as { blocker_id: string }[]).map((r) => r.blocker_id);
    set({ blocked, blockedByIds, hasHydrated: true });
  },

  block: async (userId) => {
    const uid = useAuthStore.getState().session?.user.id;
    if (!uid) return;
    const { error } = await supabase.from('blocked_users').insert({ blocker_id: uid, blocked_id: userId });
    if (!error) await get().load();
  },

  unblock: async (userId) => {
    const uid = useAuthStore.getState().session?.user.id;
    if (!uid) return;
    set((s) => ({ blocked: s.blocked.filter((b) => b.id !== userId) }));
    await supabase.from('blocked_users').delete().eq('blocker_id', uid).eq('blocked_id', userId);
  },

  reset: () => set({ blocked: [], blockedByIds: [], hasHydrated: false }),
}));

let lastUserId: string | null = null;
useAuthStore.subscribe((state) => {
  const uid = state.session?.user.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;
  if (uid) useBlockedUsersStore.getState().load();
  else useBlockedUsersStore.getState().reset();
});
