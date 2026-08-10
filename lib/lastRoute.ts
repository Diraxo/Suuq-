// Tracks the most recent in-app pathname (updated from app/_layout.tsx on every
// navigation). Used by app/+native-intent.tsx to swallow the Google OAuth
// redirect deep link (`suuqplus://auth-callback`) without it ever being routed
// to — that path has no matching screen, so letting Expo Router navigate to it
// produces a flashed "Unmatched Route" page. Returning the user's last known
// path instead is a no-op nav for a screen they never actually left, since
// sign-in itself is handled entirely via the AuthPromptModal overlay.
let lastPath = '/';

export function setLastPath(path: string): void {
  if (path.includes('auth-callback')) return;
  lastPath = path;
}

export function getLastPath(): string {
  return lastPath;
}
