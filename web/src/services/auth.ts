// Real Supabase Google OAuth, mirroring lib/authFlow.ts + store/auth.ts on
// mobile. The web flow is simpler than mobile's: signInWithOAuth() redirects
// the whole browser tab to Google (no in-app browser sheet needed), and
// Supabase's PKCE code exchange completes automatically when the browser
// lands back on `redirectTo` (see detectSessionInUrl in src/lib/supabase.ts)
// — no custom callback route required.
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { Profile } from '@/lib/types';

// Restricts the post-login destination to an internal, same-origin path.
// `redirectPath` is only ever set from hardcoded literals or the current
// location within this codebase, but this is the choke point all of them
// pass through before being handed to Supabase, so a future caller can never
// turn this into an open redirect by passing through an untrusted value
// (e.g. a `?next=` query param) — anything that isn't a genuine internal
// path (single leading slash, no scheme, no protocol-relative `//host`)
// falls back to `/`.
function sanitizeRedirectPath(path: string): string {
  if (typeof path === 'string' && /^\/(?!\/|\\)/.test(path)) return path;
  return '/';
}

export async function signInWithGoogle(redirectPath: string): Promise<{ error?: string }> {
  const redirectTo = `${window.location.origin}${sanitizeRedirectPath(redirectPath)}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) return { error: error.message };
  return {}; // browser is navigating away to Google now
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Mirrors loadOrCreateProfile in store/auth.ts on mobile: the
// `on_auth_user_created` DB trigger normally creates this row instantly;
// this upsert is only a fallback in case the profile is read before the
// trigger has committed.
//
// Wrapped so it can NEVER throw or hang the caller: a first-time Google
// sign-in racing the DB trigger, a dropped network request, or an RLS
// rejection on the fallback upsert must all resolve to `null` (guest-ish
// profile, session still valid) rather than reject — a previous version left
// the upsert's `error` unchecked, which meant a genuine network exception
// there would propagate out of init() and leave `initializing` stuck `true`
// forever (the literal "infinite loading" bug).
export async function loadOrCreateProfile(session: Session): Promise<Profile | null> {
  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (error) {
      console.error('[auth] loadOrCreateProfile: select failed', error.message);
      return null;
    }
    if (data) return data as Profile;

    const meta = session.user.user_metadata ?? {};
    const { data: created, error: upsertError } = await supabase
      .from('profiles')
      .upsert({
        id: session.user.id,
        full_name: meta.full_name ?? meta.name ?? null,
        avatar_url: meta.avatar_url ?? meta.picture ?? null,
        email: session.user.email ?? null,
      })
      .select('*')
      .maybeSingle();
    if (upsertError) {
      console.error('[auth] loadOrCreateProfile: upsert failed', upsertError.message);
      return null;
    }
    return (created as Profile) ?? null;
  } catch (err) {
    console.error('[auth] loadOrCreateProfile: unexpected error', err);
    return null;
  }
}
