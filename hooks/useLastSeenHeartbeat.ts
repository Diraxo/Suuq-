import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '@/lib/supabase';

const HEARTBEAT_INTERVAL_MS = 60_000;

/** Bumps profiles.last_seen_at (via the touch_last_seen() RPC) every 60s while
 *  the app is foregrounded — the source for the chat list's "recently active"
 *  heuristic (now() - last_seen_at < 90s; see store/chatConversations.ts).
 *  Mounted once for the life of a signed-in session. */
export function useLastSeenHeartbeat(enabled: boolean) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const touch = () => {
      supabase.rpc('touch_last_seen').then(undefined, () => {});
    };

    touch();
    intervalRef.current = setInterval(touch, HEARTBEAT_INTERVAL_MS);

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        touch();
        if (!intervalRef.current) intervalRef.current = setInterval(touch, HEARTBEAT_INTERVAL_MS);
      } else if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    });

    return () => {
      sub.remove();
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [enabled]);
}
