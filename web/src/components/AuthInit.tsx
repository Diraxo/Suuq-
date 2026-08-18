'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth';
// Side-effect import: registers store/sellerStats.ts's module-level
// useAuthStore.subscribe() prefetch listener before init() below runs, the
// same way PendingActionRunner's import of store/favorites.ts guarantees
// that store's own subscribe listener is registered early (import execution
// always precedes this component's effects). Without this, a user landing
// directly on /profile (rather than navigating there client-side) could
// import sellerStats.ts for the first time only once /profile itself
// mounts — after auth has already resolved — and miss the state
// transition the subscriber is meant to catch, silently falling back to a
// zero-stats flash.
import '@/store/sellerStats';

// Rehydrates the real Supabase session on first load (and completes the
// Google OAuth PKCE exchange if the URL has a `?code=`, via
// detectSessionInUrl in src/lib/supabase.ts). Mounted once in layout.tsx.
export function AuthInit() {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    useAuthStore.getState().init();
  }, []);
  return null;
}
