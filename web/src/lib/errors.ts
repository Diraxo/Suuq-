// Central error classifier for the web app.
//
// Every user-facing surface should funnel caught errors through toAppError()
// so people see a titled, plain-language message with a working retry — never
// a raw "Failed to fetch", a PostgREST error code, or a JS stack trace.
//
// The underlying technical detail is preserved on `AppError.detail` (and
// logged in full by logError) so a developer can still trace the failing
// request, status code, PostgREST/Postgres code, and Edge Function error —
// the friendly layer classifies the problem, it never hides it.

export type AppErrorKind =
  | 'offline'
  | 'timeout'
  | 'backend-unavailable'
  | 'auth-expired'
  | 'permission'
  | 'rate-limited'
  | 'upload-failed'
  | 'validation'
  | 'not-found'
  | 'server'
  | 'unknown';

export type AppError = {
  kind: AppErrorKind;
  title: string;
  message: string;
  /** true when retrying the same call unchanged is worthwhile (offline, timeout, 5xx, backend down). */
  retryable: boolean;
  /** Raw technical detail — for console/dev logging only, never rendered to users. */
  detail: string;
};

const COPY: Record<AppErrorKind, { title: string; message: string; retryable: boolean }> = {
  offline: {
    title: 'No internet connection',
    message: "You're currently offline. Connect to Wi-Fi or mobile data and try again.",
    retryable: true,
  },
  timeout: {
    title: 'That took too long',
    message: 'The request timed out. Check your connection and try again.',
    retryable: true,
  },
  'backend-unavailable': {
    title: "Can't reach SUUQIYE right now",
    message: "We couldn't reach our servers. Please try again in a moment.",
    retryable: true,
  },
  'auth-expired': {
    title: 'Your session has expired',
    message: 'Please sign in again to continue.',
    retryable: false,
  },
  permission: {
    title: "You don't have permission",
    message: "You don't have permission to perform this action.",
    retryable: false,
  },
  'rate-limited': {
    title: 'Too many attempts',
    message: "You've done that a lot in a short time. Please wait a little and try again.",
    retryable: false,
  },
  'upload-failed': {
    title: "We couldn't upload your image",
    message: 'Please check your connection and try again.',
    retryable: true,
  },
  validation: {
    title: 'Please check your details',
    message: 'Some information is missing or invalid. Review the form and try again.',
    retryable: false,
  },
  'not-found': {
    title: 'Not found',
    message: "We couldn't find what you were looking for — it may have been removed.",
    retryable: false,
  },
  server: {
    title: 'Something went wrong on our side',
    message: 'Please try again in a moment.',
    retryable: true,
  },
  unknown: {
    title: 'Something went wrong',
    message: 'Please try again.',
    retryable: true,
  },
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

/**
 * Map any thrown value (PostgrestError, AuthError, FunctionsError, a raw fetch
 * TypeError, an AbortError, a plain Error/string) onto an AppErrorKind.
 *
 * Deliberately conservative: anything it can't place lands on 'unknown', which
 * still shows a usable message but keeps the real error in the console.
 */
export function classifyError(err: unknown): AppErrorKind {
  const detail = toDetailString(err).toLowerCase();
  const name = String(prop<string>(err, 'name') ?? '');
  const code = String(prop(err, 'code') ?? '');
  const status = Number(prop(err, 'status') ?? prop(err, 'statusCode') ?? NaN);

  // 1. The browser is certain there is no connection.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';

  // 2. Aborted / timed out.
  if (name === 'AbortError' || detail.includes('timeout') || detail.includes('timed out') || detail.includes('aborted')) {
    return 'timeout';
  }

  // 3. Raw fetch failure while navigator.onLine was true (or unknowable). We
  //    can't tell "user's Wi-Fi is a captive portal" from "our backend is
  //    down" here — callers upgrade this to 'offline' with a live probe
  //    (isBackendReachable in ./network) before showing it.
  if (
    name === 'TypeError' &&
    (detail.includes('failed to fetch') ||
      detail.includes('networkerror') ||
      detail.includes('load failed') ||
      detail.includes('network request failed'))
  ) {
    return 'backend-unavailable';
  }
  if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') return 'backend-unavailable';

  // 4. Auth / session expiry.
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
    return 'auth-expired';
  }
  if (status === 401) return 'auth-expired';

  // 5. Permission / row-level security.
  if (
    code === '42501' ||
    detail.includes('row-level security') ||
    detail.includes('violates row-level security policy') ||
    detail.includes('permission denied')
  ) {
    return 'permission';
  }
  if (status === 403) return 'permission';

  // 6. Rate limiting. 0019_security_hardening.sql raises SQLSTATE P0001 with
  //    the literal text "Rate limit exceeded".
  if (code === 'P0001' && detail.includes('rate limit')) return 'rate-limited';
  if (status === 429 || detail.includes('rate limit exceeded') || detail.includes('too many requests')) {
    return 'rate-limited';
  }

  // 7. Validation — Postgres constraint violations & PostgREST request errors.
  if (
    code === '23502' /* not_null_violation */ ||
    code === '23503' /* foreign_key_violation */ ||
    code === '23505' /* unique_violation */ ||
    code === '23514' /* check_violation */ ||
    code === '22P02' /* invalid_text_representation */ ||
    code === '22007' /* invalid_datetime_format */ ||
    code.startsWith('PGRST10') /* schema/parse errors */
  ) {
    return 'validation';
  }
  if (code === 'PGRST116' || status === 404) return 'not-found';
  if (status === 400 || status === 409 || status === 422) return 'validation';

  // 8. Server-side failure.
  if (status >= 500 || name === 'FunctionsHttpError' || detail.includes('internal server error')) return 'server';

  return 'unknown';
}

/**
 * Build a user-facing AppError from a caught value. Pass `overrides.kind` when
 * the call site knows more than the classifier can (e.g. "this came from the
 * image upload step, so it's 'upload-failed' even though it looks generic").
 */
export function toAppError(
  err: unknown,
  overrides?: Partial<Pick<AppError, 'kind' | 'title' | 'message'>> & { fallbackKind?: AppErrorKind }
): AppError {
  let kind = overrides?.kind ?? classifyError(err);
  // e.g. the image-upload step passes fallbackKind:'upload-failed' so a generic
  // failure there is worded as an upload problem, while a clearly-classified
  // offline/auth/server error keeps its own (more accurate) wording.
  if (!overrides?.kind && kind === 'unknown' && overrides?.fallbackKind) {
    kind = overrides.fallbackKind;
  }
  const base = COPY[kind];
  return {
    kind,
    title: overrides?.title ?? base.title,
    message: overrides?.message ?? base.message,
    retryable: base.retryable,
    detail: toDetailString(err),
  };
}

/** Type guard so a caught value that is already an AppError passes through untouched. */
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

/**
 * Log the full technical error for developers. This is the "preserve
 * diagnostics" half of the friendly-error layer — the console keeps the real
 * request/status/code/stack even though the user only sees a clean message.
 */
export function logError(context: string, err: unknown): void {
  console.error(`[${context}]`, err);
}
