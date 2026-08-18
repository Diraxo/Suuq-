'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth';
import { useFavoritesStore } from '@/store/favorites';

const PENDING_FAVORITE_KEY = 'fursad-pending-favorite';

// Completes the one authenticated action that can't survive a full-page
// OAuth redirect via an in-memory closure (favoriting a listing from a card
// — see SignInModal). Runs once, as soon as a session exists after landing
// back from Google. Mounted once in layout.tsx.
export function PendingActionRunner() {
  const session = useAuthStore((s) => s.session);
  const ran = useRef(false);

  useEffect(() => {
    if (!session || ran.current) return;
    const listingId = sessionStorage.getItem(PENDING_FAVORITE_KEY);
    if (!listingId) return;
    ran.current = true;
    sessionStorage.removeItem(PENDING_FAVORITE_KEY);
    useFavoritesStore.getState().add(listingId);
  }, [session]);

  return null;
}
