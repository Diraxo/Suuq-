import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import i18n from '@/lib/i18n';

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
    if (!session) return { error: i18n.t('report.signInRequiredMessage') };
    if (targetType === 'user' && targetId === session.user.id) return { error: i18n.t('report.cannotReportSelf') };

    const { error } = await supabase.from('reports').insert({
      reporter_id: session.user.id,
      target_type: targetType,
      target_id: targetId,
      reason,
      details: details || null,
    });
    if (error) {
      if (__DEV__) console.error('[reports] submit failed:', error.message);
      return { error: i18n.t('report.submitFailedMessage') };
    }

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
// Keyed on profile.id, not session.user.id — see store/myListings.ts for why.
useAuthStore.subscribe((state) => {
  const uid = state.profile?.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;
  if (uid) useReportsStore.getState().load();
  else useReportsStore.getState().reset();
});
