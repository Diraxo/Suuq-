// Route params come from deep links, notification taps and typed URLs, so they are untrusted input: they can be missing, an
// array, absurdly long, or full of control characters. Pure (unit-tested in tests/routeParams.test.ts). Every function returns a
// safe value or the "nothing" value ('' / undefined) so a screen falls into its existing "not found" state instead of crashing
// or sending a hostile string to the database.

type Raw = string | string[] | undefined | null;

const MAX_ID_LENGTH = 64;
const MAX_TEXT_LENGTH = 80;

function first(value: Raw): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' ? v : undefined;
}

/** A record id: uuid, mock id or conversation id. '' when missing or anything but letters, digits, '_' and '-'. */
export function idParam(value: Raw): string {
  const v = first(value)?.trim();
  return v && v.length <= MAX_ID_LENGTH && /^[A-Za-z0-9_-]+$/.test(v) ? v : '';
}

/** Free text such as a city name: any letters (Somali / Amharic included), digits, spaces and . ' - ; no control characters. */
export function textParam(value: Raw, max: number = MAX_TEXT_LENGTH): string {
  const v = first(value)?.trim();
  return v && v.length <= max && /^[\p{L}\p{M}\p{N} .'’-]+$/u.test(v) ? v : '';
}

/** One of a fixed set of words (a tab name, a report type...), else undefined. */
export function enumParam<T extends string>(value: Raw, allowed: readonly T[]): T | undefined {
  const v = first(value);
  return allowed.find((a) => a === v);
}

/** A list position, clamped to 0..length-1. 0 when missing, not an integer or the list is empty. */
export function indexParam(value: Raw, length: number): number {
  const v = first(value);
  if (!v || !/^\d{1,4}$/.test(v) || length <= 0) return 0;
  return Math.min(Number(v), length - 1);
}
