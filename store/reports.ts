import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

type ReportsState = {
  reportedKeys: Set<string>;
  hasHydrated: boolean;
  isReported: (key: string) => boolean;
  load: () => Promise<void>;
  submit: (targetType: 'listing' | 'user' | 'review', targetId: string, reason: string, details: string) => Promise<{ error?: string }>;
  reset: () => void;
};

const keyOf = (targetType: string, targetId: string) => `${targetType}:${targetId}`;

export const useReportsStore = create<ReportsState>((set, get) => ({
  reportedKeys: new Set(),
  hasHydrated: false,
  isReported: (key) => get().reportedKeys.has(key),

  load: async () => {
    const session = useAuthStore.getState().session;
    if (!session) {
      set({ reportedKeys: new Set(), hasHydrated: true });
      return;
    }
    const { data } = await supabase.from('reports').select('target_type, target_id').eq('reporter_id', session.user.id);
    set({ reportedKeys: new Set((data ?? []).map((r) => keyOf(r.target_type, r.target_id))), hasHydrated: true });
  },

  submit: async (targetType, targetId, reason, details) => {
    const session = useAuthStore.getState().session;
    if (!session) return { error: 'You need to be signed in to submit a report.' };

    const { error } = await supabase.from('reports').insert({
      reporter_id: session.user.id,
      target_type: targetType,
      target_id: targetId,
      reason,
      details: details || null,
    });
    if (error) return { error: error.message };

    set((state) => {
      const next = new Set(state.reportedKeys);
      next.add(keyOf(targetType, targetId));
      return { reportedKeys: next };
    });
    return {};
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
  if (uid) useReportsStore.getState().load();
  else useReportsStore.getState().reset();
});
