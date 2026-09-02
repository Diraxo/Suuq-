'use client';

// Connectivity helpers for the web app.
//
// The core rule (from the reliability brief): navigator.onLine alone is never
// proof the backend is reachable. It only reports whether the device has *a*
// network interface up — it stays `true` behind captive portals, on a DNS
// failure, during a Supabase outage, or on a misrouted VPN. So anything that
// needs to know "can I actually talk to SUUQIYE right now" does both: the
// cheap local check first, then a real round-trip.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Cheap synchronous check — the browser's own connectivity flag. */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * Does the SUUQIYE backend actually answer right now?
 *
 * Hits GoTrue's unauthenticated health endpoint (always CORS-open, no apikey
 * required, no database load). Any HTTP response — even an error status —
 * proves the server is reachable; only a network-level failure or a timeout
 * counts as "unreachable".
 */
export async function isBackendReachable(timeoutMs = 4000): Promise<boolean> {
  if (!isOnline()) return false;
  if (!SUPABASE_URL) return true; // misconfigured env — don't block the user on our probe

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      method: 'GET',
      headers: SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY } : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    return res.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Subscribe to browser connectivity changes. Returns an unsubscribe function.
 * Only tracks the local flag — pair with isBackendReachable() when a state
 * change should trigger a real retry.
 */
export function onConnectivityChange(cb: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handleOnline = () => cb(true);
  const handleOffline = () => cb(false);
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
