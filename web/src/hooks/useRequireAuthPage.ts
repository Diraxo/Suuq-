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

  useEffect(() => {
    if (session) return;
    requireAuth(() => {}, { next: nextPath });
  }, [session, nextPath]);

  return !!session;
}
