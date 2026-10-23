import i18n from '@/lib/i18n';
import { reportError } from '@/lib/crashReporting';

// Central error classifier for the mobile app — the counterpart of
// web/src/lib/errors.ts.
//
// Funnel caught errors through toAppError() so people see a titled,
// plain-language, translated message with a sensible retry affordance —
// never a raw "Network request failed", a PostgREST code, or a JS stack.
// The raw detail is kept on `AppError.detail` and logged by logError() so a
// developer can still trace the real failure; the layer classifies, it never
// hides.

export type AppErrorKind =
  | 'offline'
  | 'timeout'
  | 'unreachable'
  | 'authExpired'
  | 'permission'
  | 'restricted'
  | 'rateLimited'
  | 'upload'
  | 'validation'
  | 'notFound'
  | 'server'
  | 'unknown';

export type AppError = {
  kind: AppErrorKind;
  title: string;
  message: string;
  retryable: boolean;
  /** Raw technical detail — for logging only, never rendered. */
  detail: string;
};

const RETRYABLE: Record<AppErrorKind, boolean> = {
  offline: true,
  timeout: true,
  unreachable: true,
  authExpired: false,
  permission: false,
  restricted: false,
  rateLimited: false,
  upload: true,
  validation: false,
  notFound: false,
  server: true,
  unknown: true,
};

function toDetailString(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    const extra = err as Error & { code?: string; status?: number; details?: string; hint?: string };
    return [
      `${extra.name}: ${extra.message}`,
      extra.code ? `code=${extra.code}` : '',
      extra.status ? `status=${extra.status}` : '',
      extra.details ? `details=${extra.details}` : '',
      extra.hint ? `hint=${extra.hint}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function prop<T = unknown>(err: unknown, key: string): T | undefined {
  return err && typeof err === 'object' ? ((err as Record<string, unknown>)[key] as T) : undefined;
}

export function classifyError(err: unknown): AppErrorKind {
  const detail = toDetailString(err).toLowerCase();
  const name = String(prop<string>(err, 'name') ?? '');
  const code = String(prop(err, 'code') ?? '');
  const status = Number(prop(err, 'status') ?? prop(err, 'statusCode') ?? NaN);

  if (name === 'AbortError' || detail.includes('timeout') || detail.includes('timed out') || detail.includes('aborted')) {
    return 'timeout';
  }
  if (
    detail.includes('network request failed') ||
    detail.includes('failed to fetch') ||
    detail.includes('networkerror') ||
    detail.includes('unable to resolve host') ||
    name === 'FunctionsFetchError' ||
    name === 'FunctionsRelayError'
  ) {
    // Can't tell "phone has no signal" from "our backend is down" from the
    // error alone — callers upgrade this to 'offline' with a live check
    // (isDeviceOnline in ./network) before showing it.
    return 'unreachable';
  }

  if (
    code === 'PGRST301' ||
    code === 'PGRST302' ||
    code === 'session_not_found' ||
    code === 'refresh_token_not_found' ||
    detail.includes('jwt expired') ||
    detail.includes('token is expired') ||
    detail.includes('invalid refresh token') ||
    detail.includes('invalid jwt')
  ) {
    return 'authExpired';
  }
  if (status === 401) return 'authExpired';

  // Raised by the database for a suspended/banned account or a listing under staff review (migration 0039) — more
  // specific than a generic permission error, and the person can do something about it (appeal / contact support).
  if (detail.includes('account suspended') || detail.includes('listing is under review')) return 'restricted';

  if (
    code === '42501' ||
    detail.includes('row-level security') ||
    detail.includes('violates row-level security policy') ||
    detail.includes('permission denied')
  ) {
    return 'permission';
  }
  if (status === 403) return 'permission';

  if (code === 'P0001' && detail.includes('rate limit')) return 'rateLimited';
  if (status === 429 || detail.includes('rate limit exceeded') || detail.includes('too many requests')) {
    return 'rateLimited';
  }

  if (
    code === '23502' ||
    code === '23503' ||
    code === '23505' ||
    code === '23514' ||
    code === '22P02' ||
    code === '22007' ||
    code.startsWith('PGRST10')
  ) {
    return 'validation';
  }
  if (code === 'PGRST116' || status === 404) return 'notFound';
  if (status === 400 || status === 409 || status === 422) return 'validation';

  if (status >= 500 || name === 'FunctionsHttpError' || detail.includes('internal server error')) return 'server';

  return 'unknown';
}

export function toAppError(
  err: unknown,
  overrides?: { kind?: AppErrorKind; title?: string; message?: string; fallbackKind?: AppErrorKind }
): AppError {
  let kind = overrides?.kind ?? classifyError(err);
  // e.g. the image-upload step passes fallbackKind:'upload' so a generic
  // failure there is worded as an upload problem, while a clearly-classified
  // offline/auth/server error keeps its own (more accurate) wording.
  if (!overrides?.kind && kind === 'unknown' && overrides?.fallbackKind) {
    kind = overrides.fallbackKind;
  }
  return {
    kind,
    title: overrides?.title ?? i18n.t(`errors.classified.${kind}.title`),
    message: overrides?.message ?? i18n.t(`errors.classified.${kind}.message`),
    retryable: RETRYABLE[kind],
    detail: toDetailString(err),
  };
}

export function isAppError(value: unknown): value is AppError {
  return (
    !!value &&
    typeof value === 'object' &&
    'kind' in value &&
    'title' in value &&
    'retryable' in value &&
    'detail' in value
  );
}

const REPORTABLE: ReadonlySet<AppErrorKind> = new Set(['server', 'unknown', 'upload']);

export function logError(context: string, err: unknown): void {
  if (__DEV__) console.error(`[${context}]`, err);
  // Offline, timeouts, expired sessions, validation and not-found are normal conditions, not bugs: only the rest is reported.
  if (REPORTABLE.has(classifyError(err))) reportError(context, err);
}
