'use client';

// Web port of hooks/useRequireAuthScreen.ts on mobile — a page-level guard
// for account-only routes (Chat, Offers, Favorites, ...). Opens the same
// sign-in modal every "Chat"/"Make offer" entry point already uses
// (store/authPrompt.ts), preserving `nextPath` as the redirect destination
// so Google sign-in returns the guest to the page they wanted.
import { useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import { requireAuth } from '@/store/authPrompt';

export function useRequireAuthPage(nextPath: string): boolean {
  const session = useAuthStore((s) => s.session);
  const initializing = useAuthStore((s) => s.initializing);

  useEffect(() => {
    // The stored session is restored asynchronously on every full page load; until that finishes a signed-in user
    // looks like a guest, and prompting then is what sent people back to "Continue with Google".
    if (session || initializing) return;
    requireAuth(() => {}, { next: nextPath });
  }, [session, initializing, nextPath]);

  return !!session;
}
