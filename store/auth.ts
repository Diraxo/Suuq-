import { create } from 'zustand';
import * as Linking from 'expo-linking';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { Session, RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { push } from '@/lib/push';
import i18n from '@/lib/i18n';
import { Profile } from '@/types';

// Must run once, at module scope, so a pending browser auth session resolves
// correctly instead of leaving the browser sheet stuck open. Official Expo
// AuthSession requirement — see https://docs.expo.dev/guides/authentication/.
WebBrowser.maybeCompleteAuthSession();

// Official Expo method for building the OAuth redirect URI: resolves to
// `suuqplus://auth-callback` in a dev client / standalone build (this
// app's scheme, from app.json), and to an `exp://` URL in Expo Go.
const redirectTo = AuthSession.makeRedirectUri({ scheme: 'suuqplus', path: 'auth-callback' });
if (__DEV__) console.log('[auth] redirect URI:', redirectTo);

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  initializing: boolean;
  init: () => Promise<void>;
  signInWithGoogle: () => Promise<{ error?: string }>;
  signInWithApple: () => Promise<{ error?: string }>;
  signInWithPassword: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

async function loadOrCreateProfile(session: Session): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error) return null;
  if (data) return data as Profile;

  // The `on_auth_user_created` DB trigger normally creates this row instantly;
  // this upsert is only a fallback in case the app reads the profile before
  // the trigger has committed.
  const meta = session.user.user_metadata ?? {};
  const { data: created } = await supabase
    .from('profiles')
    .upsert({
      id: session.user.id,
      full_name: meta.full_name ?? meta.name ?? null,
      avatar_url: meta.avatar_url ?? meta.picture ?? null,
      email: session.user.email ?? null,
    })
    .select('*')
    .maybeSingle();
  return (created as Profile) ?? null;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  initializing: true,

  init: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    set({ session });
    if (session) {
      const profile = await loadOrCreateProfile(session);
      set({ profile });
      push.register(session.user.id);
    }
    set({ initializing: false });

    supabase.auth.onAuthStateChange(async (event, nextSession) => {
      set({ session: nextSession });
      if (event === 'SIGNED_OUT' || !nextSession) {
        set({ profile: null });
        return;
      }
      const profile = await loadOrCreateProfile(nextSession);
      set({ profile });
      push.register(nextSession.user.id);
    });
  },

  signInWithGoogle: async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (__DEV__) console.log('[auth] OAuth URL:', data?.url, error?.message);
    if (error || !data?.url) return { error: error?.message ?? i18n.t('profile.googleSignInFailed') };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (__DEV__) console.log('[auth] callback result:', result.type, result.type === 'success' ? result.url : '');
    if (result.type !== 'success' || !result.url) {
      return result.type === 'cancel' || result.type === 'dismiss' ? {} : { error: i18n.t('profile.signInIncomplete') };
    }

    const code = Linking.parse(result.url).queryParams?.code;
    if (__DEV__) console.log('[auth] returned code:', code);
    if (!code || typeof code !== 'string') {
      return { error: i18n.t('profile.authCodeMissing') };
    }
    const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (__DEV__) console.log('[auth] exchangeCodeForSession result:', exchangeError?.message ?? exchangeData?.session?.user?.id);
    if (exchangeError) return { error: exchangeError.message };
    return {};
  },

  // Native Sign in with Apple (iOS only). Apple's identity token is exchanged
  // for a Supabase session via signInWithIdToken, so Apple users land in the
  // same auth.users/profiles tables as Google users. The raw nonce goes to
  // Supabase; only its SHA-256 goes to Apple (Supabase verifies they match).
  signInWithApple: async () => {
    if (Platform.OS !== 'ios') return { error: i18n.t('profile.signInIncomplete') };
    // Lazy require: keeps the native module out of the Android/web bundles' startup path.
    const AppleAuthentication = require('expo-apple-authentication') as typeof import('expo-apple-authentication');
    try {
      const rawNonce = Crypto.randomUUID() + Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashedNonce,
      });
      if (!credential.identityToken) return { error: i18n.t('profile.signInIncomplete') };

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        nonce: rawNonce,
      });
      if (error) return { error: error.message };

      // Apple returns the user's name only on the very first authorization, and
      // never inside the identity token — so persist it now, but only into an
      // empty profile name (never overwrite what the user already has).
      const given = credential.fullName?.givenName?.trim();
      const family = credential.fullName?.familyName?.trim();
      const fullName = [given, family].filter(Boolean).join(' ');
      if (fullName && data.user) {
        const { error: nameError } = await supabase.from('profiles').update({ full_name: fullName }).eq('id', data.user.id).is('full_name', null);
        if (!nameError) await get().refreshProfile();
      }
      return {};
    } catch (err) {
      // User dismissed the Apple sheet — not an error.
      if ((err as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return {};
      return { error: i18n.t('profile.signInIncomplete') };
    }
  },

  // Email/password sign-in. The app itself only exposes Google OAuth to real
  // users — this path exists solely for the Google Play / App Store review
  // teams, who cannot complete a Google OAuth flow with a shared test account.
  // It is reached only through the hidden long-press entry point on the guest
  // Profile screen (see ReviewerSignInModal). The `onAuthStateChange` listener
  // in `init` handles profile load + push registration on success, same as OAuth.
  signInWithPassword: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { error: error.message };
    return {};
  },

  signOut: async () => {
    const userId = get().session?.user.id;
    if (userId) await push.unregister(userId);
    await supabase.auth.signOut();
    set({ session: null, profile: null });
  },

  refreshProfile: async () => {
    const { session } = get();
    if (!session) return;
    const profile = await loadOrCreateProfile(session);
    set({ profile });
  },
}));

// Realtime propagation for Edit Profile: any change to this user's profiles
// row — from this device or another — refreshes the store, and since every
// screen (Profile tab, profileToSeller() call sites) reads `profile` from
// this store, they all update instantly with no manual refresh/logout/
// restart. Same module-level-channel pattern as
// store/follow.ts / store/notifications.ts.
let lastProfileRealtimeUserId: string | null = null;
let profileRealtimeChannel: RealtimeChannel | null = null;
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` }, () => useAuthStore.getState().refreshProfile())
      .subscribe();
  }
});
