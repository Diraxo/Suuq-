import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';
import { parsePolicyRow, UpdatePlatform, UpdatePolicy } from '@/lib/appUpdate';
import { createUpdateController, FetchResult, isBlocking, UpdateStatus } from '@/lib/appUpdateController';

// The mandatory-update controller wired to the real app: Supabase (public, read-only table), AsyncStorage cache, the installed version.
// See docs/MANDATORY_UPDATES.md.

const CACHE_KEY = '@suuq/app-update-policy';
const FETCH_TIMEOUT_MS = 8000;

export const updatePlatform: UpdatePlatform | null = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null;

/** The installed marketing version (app.json "version"), never the native build number. */
export function installedVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

async function fetchPolicy(): Promise<FetchResult> {
  if (!updatePlatform) return { ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const { data, error } = await supabase
      .from('app_update_policy')
      .select('platform, enabled, recommended_version, minimum_version, store_url, message')
      .eq('platform', updatePlatform)
      .abortSignal(controller.signal)
      .maybeSingle();
    if (error) return { ok: false };
    const policy = parsePolicyRow(data, updatePlatform);
    return policy ? { ok: true, policy } : { ok: false };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function toRow(p: UpdatePolicy) {
  return { platform: p.platform, enabled: p.enabled, recommended_version: p.recommendedVersion, minimum_version: p.minimumVersion, store_url: p.storeUrl, message: p.message };
}

const controller = createUpdateController({
  fetchPolicy,
  getInstalledVersion: installedVersion,
  loadCache: async () => {
    if (!updatePlatform) return null;
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      return raw ? parsePolicyRow(JSON.parse(raw), updatePlatform) : null;
    } catch {
      return null;
    }
  },
  saveCache: (p) => AsyncStorage.setItem(CACHE_KEY, JSON.stringify(toRow(p))),
  now: () => Date.now(),
  schedule: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
});

const WEB_STATUS: UpdateStatus = { phase: 'ready', decision: { kind: 'ok' }, lastFetchFailed: false };

let started = false;
/** Call once from the root layout. Starts the startup check and the foreground recheck. */
export function startAppUpdateCheck(): () => void {
  if (!updatePlatform || started) return () => {};
  started = true;
  void controller.start();
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void controller.onForeground();
  });
  return () => sub.remove();
}

export function retryAppUpdateCheck(): void {
  void controller.retry();
}

export function useAppUpdateStatus(): UpdateStatus {
  return useSyncExternalStore(controller.subscribe, updatePlatform ? controller.getStatus : () => WEB_STATUS, () => WEB_STATUS);
}

export { isBlocking };
