// Decides whether a Supabase write really succeeded. supabase-js reports a row-level-security refusal or a missing row as
// `error: null` with zero rows, so "no error" alone is NOT proof of success: callers ask for the written rows back
// (`.select('id')`) and pass the result here. Platform-free; web keeps a byte-identical copy (tests/imageParity.test.ts).

export type SaveFailureCode = 'auth' | 'permission' | 'invalid' | 'offline' | 'unavailable' | 'failed';

export type SaveOutcome = { ok: true } | { ok: false; code: SaveFailureCode };

type WriteError = { message?: string; code?: string; status?: number } | null | undefined;

export function classifyWriteError(error: NonNullable<WriteError>): SaveFailureCode {
  const msg = String(error.message ?? '');
  const code = String(error.code ?? '');
  const status = Number(error.status ?? 0);
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303' || /jwt/i.test(msg)) return 'auth';
  if (status === 403 || code === '42501' || /row-level security|permission denied/i.test(msg)) return 'permission';
  if (/^(22|23)/.test(code) || code === 'P0001' || code === 'PGRST204') return 'invalid';
  if (/failed to fetch|network|load failed|timed? ?out|aborted/i.test(msg)) return 'offline';
  if (status >= 500 || /^(53|57|08)/.test(code)) return 'unavailable';
  return 'failed';
}

/** A thrown error (fetch rejects with TypeError when the device is offline) in the same vocabulary. */
export function classifyThrown(err: unknown): SaveFailureCode {
  if (err instanceof TypeError) return 'offline';
  const e = err as { name?: string; message?: string } | null;
  if (e?.name === 'AbortError') return 'offline';
  return classifyWriteError({ message: e?.message });
}

/** `data` must be the rows returned by `.select(...)` on the write; an empty result means nothing was changed. */
export function interpretWrite(result: { data?: unknown; error?: WriteError } | null | undefined): SaveOutcome {
  if (!result) return { ok: false, code: 'failed' };
  if (result.error) return { ok: false, code: classifyWriteError(result.error) };
  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
  if (rows.length === 0) return { ok: false, code: 'permission' };
  return { ok: true };
}
