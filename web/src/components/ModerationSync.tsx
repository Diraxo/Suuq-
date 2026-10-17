'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { startVisibilitySync } from '@/lib/visibilitySync';
import { getKnownListingIds, useVisibilityStore } from '@/store/visibility';
import { useAuthStore } from '@/store/auth';
// Side-effect import: registers the moderation store's auth subscription (notices/cases/account state + Realtime).
import '@/store/moderation';

// Mounted once in layout.tsx. Keeps every open page honest about listing visibility:
//  - broadcast events hide/show a listing the moment staff act on it,
//  - the known-ids reconciliation runs on every (re)connect and whenever the tab becomes visible again.
// Pages read the result from useVisibilityStore (see withoutHidden); nothing here touches page state directly.
export function ModerationSync() {
  const signedIn = useAuthStore((s) => !!s.session);
  const syncRef = useRef<ReturnType<typeof startVisibilitySync> | null>(null);

  useEffect(() => {
    const { markHidden, markShown } = useVisibilityStore.getState();
    const sync = startVisibilitySync(supabase as never, {
      onHidden: markHidden,
      onShown: markShown,
      getKnownIds: getKnownListingIds,
    });
    syncRef.current = sync;
    const onVisible = () => document.visibilityState === 'visible' && void sync.reconcile();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      sync.stop();
    };
  }, []);

  // Public visibility is not per-account, so the hidden set is kept; but a sign-in/out can change what the page
  // shows (the owner's own listings), so re-check the displayed ids.
  useEffect(() => {
    void syncRef.current?.reconcile();
  }, [signedIn]);

  return null;
}
