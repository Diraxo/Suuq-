import { getLastPath } from '@/lib/lastRoute';

// The Supabase Google OAuth redirect (`suuqplus://auth-callback?code=...`) is
// consumed directly by expo-web-browser's Linking listener inside
// store/auth.ts's signInWithGoogle() — the auth code is read straight off
// that result, never off Router state. But the same native "url" event is
// also delivered to Expo Router's own linking subscriber, which then tries to
// navigate to `/auth-callback`. No such screen exists, so without this file
// the user briefly sees the default "Unmatched Route" page and can get bounced
// to whatever the root splash redirect (app/index.tsx) decides — onboarding or
// Home — instead of staying on the screen that opened the sign-in prompt.
// Redirecting this one path back to wherever the user already is makes the
// whole round trip a no-op from Router's perspective.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.includes('auth-callback')) {
    return getLastPath();
  }
  return path;
}
