import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import i18n from '@/lib/i18n';
import { Platform } from 'react-native';

// Apple requires revoking the Sign in with Apple token when such an account is
// deleted. Re-prompts Apple (no scopes, no extra data) for a fresh
// authorizationCode the delete-account function can exchange + revoke.
// Cancellation or failure never blocks deletion.
async function getAppleAuthorizationCode(): Promise<string | undefined> {
  if (Platform.OS !== 'ios') return undefined;
  const identities = useAuthStore.getState().session?.user.identities ?? [];
  if (!identities.some((i) => i.provider === 'apple')) return undefined;
  try {
    const AppleAuthentication = require('expo-apple-authentication') as typeof import('expo-apple-authentication');
    const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
    return credential.authorizationCode ?? undefined;
  } catch {
    return undefined;
  }
}

// Single choke point for permanent account deletion, used by
// app/settings/delete-account.tsx — mirrors lib/authFlow.ts's shape.
// The delete-account edge function hard-deletes the auth.users row, which
// cascades through every FK'd table (including messages/message_reactions),
// plus best-effort cleans up R2 images. Once that succeeds, the
// server-side user no longer exists, so this clears local session state
// directly rather than calling supabase.auth.signOut() (which would just
// fail against a session whose user is already gone).
export async function deleteAccount(): Promise<{ error?: string }> {
  const { data, error } = await supabase.functions.invoke<{ success?: boolean; error?: string }>('delete-account', {
    body: { appleAuthorizationCode: await getAppleAuthorizationCode() },
  });
  if (error || data?.error) {
    // supabase-js reports every non-2xx as FunctionsHttpError with data null; the function's
    // real { error } body is on error.context (a Response), so read it for the dev log.
    let serverError: string | undefined;
    let status: number | undefined;
    // Duck-typed: React Native's fetch Response is not the global `Response` class.
    const ctx = (error as { context?: { status?: number; text?: () => Promise<string> } } | null)?.context;
    if (ctx) {
      status = ctx.status;
      serverError = await ctx.text?.().catch(() => undefined);
    }
    if (__DEV__ && error) console.error('[accountDeletion] edge function call failed:', status, serverError ?? error.message);
    return { error: data?.error ?? i18n.t('accountDeletion.failed') };
  }

  await supabase.auth.signOut().catch(() => {});
  useAuthStore.setState({ session: null, profile: null });

  return {};
}
