'use client';

import { create } from 'zustand';
import { useAuthStore } from './auth';

type AuthPromptState = {
  visible: boolean;
  pending: (() => void) | null;
  /** Page to redirect back to after Google sign-in completes (defaults to the current page). */
  next: string | null;
  /** Listing id to favorite once sign-in completes, for actions that can't survive
   *  the full-page OAuth redirect (e.g. tapping the heart on a listing card) — see
   *  PendingActionRunner, which reads this back out of sessionStorage after redirect. */
  pendingFavoriteId: string | null;
  open: (action?: () => void, opts?: { next?: string; pendingFavoriteId?: string }) => void;
  dismiss: () => void;
};

// Mirrors store/authPrompt.ts on mobile: requireAuth() runs the action
// immediately if already signed in, otherwise opens the sign-in sheet.
// Unlike mobile (an in-app browser sheet whose JS state survives sign-in),
// web sign-in is a full-page redirect to Google and back, so `pending`
// closures only matter for the "already signed in" fast path — the
// not-signed-in path instead relies on `next` (redirect destination) and,
// for the one inline action that needs it, `pendingFavoriteId`.
export const useAuthPromptStore = create<AuthPromptState>((set) => ({
  visible: false,
  pending: null,
  next: null,
  pendingFavoriteId: null,
  open: (action, opts) =>
    set({
      visible: true,
      pending: action ?? null,
      next: opts?.next ?? null,
      pendingFavoriteId: opts?.pendingFavoriteId ?? null,
    }),
  dismiss: () => set({ visible: false, pending: null, next: null, pendingFavoriteId: null }),
}));

export function requireAuth(action: () => void, opts?: { next?: string; pendingFavoriteId?: string }) {
  if (useAuthStore.getState().session) {
    action();
    return;
  }
  useAuthPromptStore.getState().open(action, opts);
}
