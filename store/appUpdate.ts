import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';
import { OptionalUpdate, parsePolicyRow, policyToRow, UpdatePlatform } from '@/lib/appUpdate';
import { recordUpdateDismissal } from '@/store/appUpdateDismissals';
import { createReminderStore, ReminderState } from '@/lib/appUpdateReminder';
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

// Policy columns that exist since migration 0078, and the full set since 0090 (release announcements). An app shipped before 0090 is
// applied must keep enforcing the 0078 minimum, so a rejected full select falls back to the legacy one instead of failing open.
const LEGACY_COLUMNS = 'platform, enabled, recommended_version, minimum_version, store_url, message';
const FULL_COLUMNS = `${LEGACY_COLUMNS}, reminder_interval_hours, first_reminder_delay_hours, show_whats_new, support_url, release:app_releases!current_release_id(id, platform, version, version_code, release_type, title, description, changelog, translations, mandatory, minimum_supported_version, target_version, android_store_url, ios_store_url, support_url, published, expires_at)`;

async function selectPolicyRow(platform: UpdatePlatform, columns: string): Promise<{ data: unknown; failed: boolean; answered: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const { data, error } = await supabase.from('app_update_policy').select(columns).eq('platform', platform).abortSignal(controller.signal).maybeSingle();
    return error ? { data: null, failed: true, answered: true } : { data, failed: false, answered: true };
  } catch {
    return { data: null, failed: true, answered: false };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPolicy(): Promise<FetchResult> {
  if (!updatePlatform) return { ok: false };
  let res = await selectPolicyRow(updatePlatform, FULL_COLUMNS);
  // Only when the server answered with an error (e.g. unknown column before 0090): a network failure is not retried here (the controller backs off).
  if (res.failed && res.answered) res = await selectPolicyRow(updatePlatform, LEGACY_COLUMNS);
  if (res.failed) return { ok: false };
  const policy = parsePolicyRow(res.data, updatePlatform);
  return policy ? { ok: true, policy } : { ok: false };
}

/** The installed Android versionCode from the build-embedded config (null on iOS or when absent). Never used to block, only to tell builds of one version apart. */
export function installedBuild(): number | null {
  const code = Platform.OS === 'android' ? Constants.expoConfig?.android?.versionCode : null;
  return typeof code === 'number' && Number.isInteger(code) && code > 0 ? code : null;
}

const controller = createUpdateController({
  fetchPolicy,
  getInstalledVersion: installedVersion,
  getInstalledBuild: installedBuild,
  loadCache: async () => {
    if (!updatePlatform) return null;
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      return raw ? parsePolicyRow(JSON.parse(raw), updatePlatform) : null;
    } catch {
      return null;
    }
  },
  saveCache: (p) => AsyncStorage.setItem(CACHE_KEY, JSON.stringify(policyToRow(p))),
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

// ── Dismissible reminders (normal / important). Local storage works signed-out; a signed-in dismissal is also recorded server-side (best effort). ──
const REMINDER_KEY = '@suuq/app-update-reminders';
const reminders = createReminderStore({
  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(REMINDER_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ReminderState) : {};
    } catch {
      return {};
    }
  },
  save: (state) => AsyncStorage.setItem(REMINDER_KEY, JSON.stringify(state)),
  now: () => Date.now(),
});

/** Is this dismissible update due to be shown now? Marks it shown for the session, so call it once per update. */
export function shouldShowUpdateReminder(update: OptionalUpdate): Promise<boolean> {
  return updatePlatform ? reminders.shouldShow(updatePlatform, update) : Promise.resolve(false);
}

/** "Remind me later". */
export async function dismissUpdateReminder(update: OptionalUpdate): Promise<void> {
  if (!updatePlatform) return;
  const { dismissedAt, remindAfter } = await reminders.dismiss(updatePlatform, update);
  if (update.release) void recordUpdateDismissal({ releaseId: update.release.id, platform: updatePlatform, dismissedAt, remindAfter });
}
