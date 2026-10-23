// Pure rules for the display-name change limit (migration 0075): at most 2 successful changes of profiles.full_name in any rolling
// 7 days, enforced by the database. These helpers only read what the server says and decide whether a save would count; they never
// grant or deny anything themselves. The web build cannot import from outside web/, so web/src/lib/nameChangeRules.ts is a
// byte-identical copy (tests/nameChange.test.ts fails if they drift).

export type NameChangeStatus = {
  limit: number;
  windowDays: number;
  used: number;
  remaining: number;
  /** When the next change is allowed. Null while at least one change is still available. */
  nextAvailableAt: Date | null;
};

/** Parses the jsonb returned by my_name_change_status(). Anything malformed means "unknown" (null): the UI then shows no counter. */
export function parseNameChangeStatus(raw: unknown): NameChangeStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const limit = num(r.limit);
  const windowDays = num(r.window_days);
  const used = num(r.used);
  const remaining = num(r.remaining);
  if (limit === null || windowDays === null || used === null || remaining === null) return null;
  let nextAvailableAt: Date | null = null;
  if (typeof r.next_available_at === 'string') {
    const d = new Date(r.next_available_at);
    if (!Number.isNaN(d.getTime())) nextAvailableAt = d;
  }
  return { limit, windowDays, used, remaining, nextAvailableAt };
}

type DbError = { message?: string | null; hint?: string | null; details?: string | null; code?: string | null } | null | undefined;

export function isNameChangeLimitError(error: DbError): boolean {
  return !!error && /name_change_limit/.test(`${error.hint ?? ''} ${error.message ?? ''}`);
}

/** The time the database reported in the refusal (its `detail`), or null when it did not send a readable one. */
export function nameChangeLimitUntil(error: DbError): Date | null {
  if (!isNameChangeLimitError(error) || !error?.details) return null;
  // Postgres prints a timestamptz as "2026-10-29 10:00:00.123456+00": make it ISO ("T", and "+00:00") so every engine parses it.
  const iso = error.details.trim().replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Same comparison the database makes: only a real change of the trimmed name counts toward the limit. */
export function isNameChange(oldName: string | null | undefined, newName: string | null | undefined): boolean {
  return (oldName ?? '').trim() !== (newName ?? '').trim();
}

/** True when saving `newName` would be refused locally-known: the account has no changes left and the name really changes. */
export function wouldExceedNameLimit(status: NameChangeStatus | null, oldName: string | null | undefined, newName: string | null | undefined): boolean {
  return !!status && status.remaining <= 0 && !!(oldName ?? '').trim() && isNameChange(oldName, newName);
}

/** "Oct 29, 2026, 3:15 PM" in the viewer's language. */
export function formatNextAvailable(date: Date, locale?: string): string {
  try {
    return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return date.toISOString();
  }
}
