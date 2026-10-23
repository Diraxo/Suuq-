'use client';

import { useEffect, useState } from 'react';
import { X } from '@/lib/icons';
import { GoogleSignInButton } from './GoogleSignInButton';
import { useAuthPromptStore } from '@/store/authPrompt';
import { useAuthStore } from '@/store/auth';
import { useT } from '@/lib/i18n';

const PENDING_FAVORITE_KEY = 'fursad-pending-favorite';

// Mirrors components/AuthPrompt on mobile — same subtitle copy, triggered by
// requireAuth() from any gated action (Sell, Chat, Favorite, Follow, Offer...).
export function SignInModal() {
  const t = useT();
  const visible = useAuthPromptStore((s) => s.visible);
  const next = useAuthPromptStore((s) => s.next);
  const pendingFavoriteId = useAuthPromptStore((s) => s.pendingFavoriteId);
  const dismiss = useAuthPromptStore((s) => s.dismiss);
  const session = useAuthStore((s) => s.session);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signingIn = useAuthStore((s) => s.signingIn);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // The Google round trip is a full-page redirect, so this modal (opened by
  // the pre-redirect page, e.g. Sell's "not signed in" effect) remounts
  // fresh on return and stays visible until something closes it. AuthInit's
  // init() resolves the session asynchronously right after — without this,
  // the already-authenticated page underneath renders normally while this
  // modal keeps showing "Sign in to continue" on top of it until the user
  // clicks away, which reads as broken/contradictory state.
  useEffect(() => {
    if (visible && session) dismiss();
  }, [visible, session, dismiss]);

  if (!visible) return null;

  const handleSignIn = async () => {
    setErrorMessage(null);
    // Stashed here (not in the closure the modal was opened with) because a
    // real OAuth sign-in is a full-page redirect to Google and back — any
    // in-memory JS state, including zustand stores, is gone when the app
    // reloads. sessionStorage survives the round trip; PendingActionRunner
    // (mounted in layout.tsx) picks this back up once the session exists.
    if (pendingFavoriteId) sessionStorage.setItem(PENDING_FAVORITE_KEY, pendingFavoriteId);
    const { error } = await signInWithGoogle(next ?? undefined);
    if (error) {
      sessionStorage.removeItem(PENDING_FAVORITE_KEY);
      setErrorMessage(error); // stays on this page; every failure path is user-visible, never a silent/infinite spinner
      return;
    }
    // else: browser is already navigating to Google, nothing else to do here.
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center"
      onClick={() => {
        setErrorMessage(null);
        dismiss();
      }}
    >
      <div
        className="w-full max-w-sm rounded-t-xl bg-surface p-6 pb-8 shadow-md md:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end">
          <button
            onClick={() => {
              setErrorMessage(null);
              dismiss();
            }}
            aria-label={t('chat.dismiss')}
            className="rounded-full p-1 hover:bg-inputBackground"
          >
            <X size={18} className="text-textMuted" />
          </button>
        </div>
        <h2 className="text-xl font-bold text-textPrimary">{t('components.authPrompt.title')}</h2>
        <p className="mt-2 text-sm text-textSecondary">
          {t('components.authPrompt.subtitle')}
        </p>
        {errorMessage && (
          <p className="mt-3 rounded-md bg-error/10 px-3 py-2 text-sm text-error">{t.text(errorMessage)}</p>
        )}
        <GoogleSignInButton label={t('web.t.continueWithGoogle')} loading={signingIn} onClick={handleSignIn} className="mt-6" />
      </div>
    </div>
  );
}
