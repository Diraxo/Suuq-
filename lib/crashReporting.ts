import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { scrubBreadcrumb, scrubEvent, scrubText } from '@/lib/crashScrub';

// Crash reporting. Inert until EXPO_PUBLIC_SENTRY_DSN is set (a DSN is a public, write-only ingest address, not a secret), so
// builds without it behave exactly as before. Everything sent passes through lib/crashScrub.ts first; no user, IP, request or
// device name is ever attached.

const DSN = (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim();
let started = false;

export function initCrashReporting(): void {
  if (started || !DSN || __DEV__) return;
  started = true;
  try {
    Sentry.init({
      dsn: DSN,
      release: Constants.expoConfig?.version,
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableAutoSessionTracking: true,
      // Errors and unhandled promise rejections only; no performance traces for now (cost, and more data leaves the phone).
      tracesSampleRate: 0,
      beforeSend: (event) => scrubEvent(event as never) as never,
      beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb as never) as never,
    });
  } catch {
    started = false; // reporting must never be the thing that breaks startup
  }
}

/** Sends one handled/unhandled error with a short, scrubbed context label. Never throws. */
export function reportError(context: string, err: unknown): void {
  if (!started) return;
  try {
    Sentry.captureException(err instanceof Error ? err : new Error(scrubText(String(err))), { tags: { context } });
  } catch {
    /* ignore */
  }
}
