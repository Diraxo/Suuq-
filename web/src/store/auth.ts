'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { Profile } from '@/lib/types';
import { signInWithGoogle as signInWithGoogleService, signOut as signOutService, loadOrCreateProfile } from '@/services/auth';

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  initializing: boolean;
  signingIn: boolean;
  init: () => Promise<void>;
  signInWithGoogle: (redirectPath?: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

// A hung profile fetch (bad network, RLS surprise, etc.) must never keep the
// app stuck on a loading state forever — race it against a timeout so
// `initializing`/the caller always gets a resolution one way or another.
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(onTimeout);
      });
  });
}

// Real Supabase session (shared with the mobile app) — replaces the Phase 1
// localStorage demo session. Session itself already persists via
// supabase-js's own localStorage adapter (see src/lib/supabase.ts), so this
// store isn't zustand-persisted — init() rehydrates it from Supabase on load.
export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  initializing: true,
  signingIn: false,

  init: async () => {
    // Registered before the initial getSession() call so no SIGNED_IN event
    // fired during Supabase's own URL/PKCE-code handling (detectSessionInUrl,
    // src/lib/supabase.ts) can be missed while this function is still awaiting.
    supabase.auth.onAuthStateChange(async (event, nextSession) => {
      set({ session: nextSession });
      if (event === 'SIGNED_OUT' || !nextSession) {
        set({ profile: null });
        return;
      }
      const profile = await withTimeout(loadOrCreateProfile(nextSession), 10000, null);
      set({ profile });
    });

    // try/finally: whatever happens below (network failure, thrown error),
    // `initializing` must always resolve to `false` — that's what used to
    // leave pages stuck on an infinite loading state after a first-time
    // Google sign-in when the fallback profile upsert threw. See
    // loadOrCreateProfile in src/services/auth.ts for the matching fix.
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      set({ session });
      if (session) {
        const profile = await withTimeout(loadOrCreateProfile(session), 10000, null);
        set({ profile });
      }
    } catch (err) {
      console.error('[auth] init failed', err);
    } finally {
      set({ initializing: false });
    }
  },

  signInWithGoogle: async (redirectPath) => {
    set({ signingIn: true });
    try {
      const next = redirectPath ?? `${window.location.pathname}${window.location.search}`;
      const { error } = await signInWithGoogleService(next);
      return { error };
    } catch (err) {
      console.error('[auth] signInWithGoogle failed', err);
      return { error: 'Something went wrong starting Google sign-in. Please try again.' };
    } finally {
      // If signInWithOAuth succeeded, the browser is already navigating away
      // to Google and this line races the page unload — harmless either way.
      // If it failed, this is what stops the button spinning forever.
      set({ signingIn: false });
    }
  },

  signOut: async () => {
    await signOutService();
    set({ session: null, profile: null });
  },

  refreshProfile: async () => {
    const { session } = get();
    if (!session) return;
    const profile = await loadOrCreateProfile(session);
    set({ profile });
  },
}));

// Convenience selector for the common "signed-in display identity" case
// (avatar/name in the header, profile page, sign-in modal, etc.) — mirrors
// profileToSeller()'s avatar fallback on mobile (lib/sellerStats.ts) so a
// profile with no avatar_url (e.g. a Google account with no photo) still
// renders something instead of a broken image.
//
// Keyed off `session` alone, not `session && profile`: the `profiles` row
// loads asynchronously after sign-in (and can legitimately fail — see
// loadOrCreateProfile) but the user IS authenticated as soon as a session
// exists. Requiring both used to mean a slow/failed profile fetch left an
// authenticated user stuck looking like a signed-out guest indefinitely.
// Google's own `user_metadata` (name/picture) covers the gap until the
// `profiles` row is available.
export function useCurrentUser(): { id: string; name: string; avatar: string; verified: boolean } | null {
  // Select the raw session/profile slices (stable references from the store)
  // rather than building the derived object inside the selector itself — a
  // selector that returns a fresh object literal every call defeats
  // useSyncExternalStore's Object.is snapshot check and causes React to
  // report "getSnapshot should be cached" / re-render in an infinite loop.
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);

  return useMemo(() => {
    if (!session) return null;
    const meta = session.user.user_metadata ?? {};
    const id = profile?.id ?? session.user.id;
    return {
      id,
      name: profile?.full_name ?? meta.full_name ?? meta.name ?? session.user.email ?? 'SUUQIYE user',
      avatar: profile?.avatar_url ?? meta.avatar_url ?? meta.picture ?? `https://picsum.photos/seed/${id}/200/200`,
      // The same profiles.verified_at other viewers read (set only by admin_set_verified) - never inferred client-side.
      verified: !!profile?.verified_at,
    };
  }, [session, profile]);
}

// Keeps the signed-in user's own profile (verified_at, account_status, ...) fresh: a staff decision made while this tab
// is open arrives over Realtime, and a tab that was backgrounded refreshes when it becomes visible again. Without this
// the owner kept seeing the profile they loaded at sign-in while everyone else saw the new verified badge.
let lastProfileRealtimeUserId: string | null = null;
let profileRealtimeChannel: ReturnType<typeof supabase.channel> | null = null;
useAuthStore.subscribe((state) => {
  const uid = state.session?.user.id ?? null;
  if (uid === lastProfileRealtimeUserId) return;
  lastProfileRealtimeUserId = uid;
  if (profileRealtimeChannel) {
    supabase.removeChannel(profileRealtimeChannel);
    profileRealtimeChannel = null;
  }
  if (uid) {
    profileRealtimeChannel = supabase
      .channel(`profile-${uid}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` }, () => {
        void useAuthStore.getState().refreshProfile();
      })
      .subscribe();
  }
});
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && useAuthStore.getState().session) void useAuthStore.getState().refreshProfile();
  });
}
