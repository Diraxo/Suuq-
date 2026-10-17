'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

type Watch = { table: string; filter?: string };

/**
 * Calls `reload` whenever a watched row changes (Supabase Realtime), when the tab is shown again, and when the
 * network comes back, so a screen never keeps showing numbers from before the change. A short debounce folds a
 * burst of changes into a single reload.
 */
export function useLiveReload(key: string | null, watches: Watch[], reload: () => void) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const watchKey = JSON.stringify(watches);

  useEffect(() => {
    if (!key) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => reloadRef.current(), 250);
    };

    let channel = supabase.channel(`live-${key}-${Math.random().toString(36).slice(2, 8)}`);
    for (const w of JSON.parse(watchKey) as Watch[]) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: w.table, ...(w.filter ? { filter: w.filter } : {}) }, fire);
    }
    channel.subscribe();

    const onVisible = () => {
      if (document.visibilityState === 'visible') fire();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', fire);
    window.addEventListener('focus', fire);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', fire);
      window.removeEventListener('focus', fire);
      supabase.removeChannel(channel);
    };
  }, [key, watchKey]);
}
