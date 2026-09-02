import * as Network from 'expo-network';

// Connectivity helpers for the mobile app.
//
// Same rule as the web side (lib/network.ts under web/): a device reporting
// "connected" is not proof the backend is reachable — it stays connected on a
// captive portal, a DNS failure, a Supabase outage, or a broken VPN route. So
// anything that needs to know "can I actually talk to SUUQIYE right now" does
// both: the cheap OS check first, then a real round-trip.

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** OS-level connectivity flag. Best-effort — returns true if expo-network throws. */
export async function isDeviceOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.isConnected === false) return false;
    if (state.isInternetReachable === false) return false;
    return true;
  } catch {
    return true;
  }
}

/**
 * Does the SUUQIYE backend actually answer right now? OS connectivity check
 * first, then a timed request to GoTrue's unauthenticated health endpoint.
 * Any HTTP response proves reachability; only a network failure or timeout
 * counts as unreachable.
 */
export async function isBackendReachable(timeoutMs = 4000): Promise<boolean> {
  if (!(await isDeviceOnline())) return false;
  if (!SUPABASE_URL) return true; // misconfigured env — don't block on our own probe

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      method: 'GET',
      headers: SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY } : undefined,
      signal: controller.signal,
    });
    return res.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
