import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { activeMode, ProfileMode } from '@/lib/profileIdentity';

export type SwitchResult = { ok: true } | { ok: false; reason: 'unavailable' | 'failed' };

/** The signed-in user's active identity and the one way to change it (set_active_mode RPC, migration 0064). The change is applied to the
 *  local profile at once and rolled back if the server refuses; the profiles realtime channel then carries it to every other screen/viewer. */
export function useActiveMode() {
  const profile = useAuthStore((s) => s.profile);
  const [busy, setBusy] = useState(false);
  const mode = activeMode(profile);
  // Every signed-in account may use Business mode: it adds a banner and business details around the same person, never a second identity.
  const canUseBusiness = !!profile;

  const switchTo = useCallback(
    async (next: ProfileMode): Promise<SwitchResult> => {
      const current = useAuthStore.getState().profile;
      if (!current) return { ok: false, reason: 'failed' };
      if (activeMode(current) === next) return { ok: true };
      setBusy(true);
      useAuthStore.setState({ profile: { ...current, active_mode: next } });
      const { error } = await supabase.rpc('set_active_mode', { p_mode: next });
      setBusy(false);
      if (!error) return { ok: true };
      // Roll back only if nothing newer replaced the optimistic value.
      const now = useAuthStore.getState().profile;
      if (now?.id === current.id && now.active_mode === next) useAuthStore.setState({ profile: current });
      if (error.code === '42883' || error.code === 'PGRST202') return { ok: false, reason: 'unavailable' };
      if (/business_profile_incomplete/.test(`${error.hint ?? ''} ${error.message}`)) return { ok: false, reason: 'unavailable' };
      return { ok: false, reason: 'failed' };
    },
    []
  );

  return { mode, canUseBusiness, busy, switchTo };
}
