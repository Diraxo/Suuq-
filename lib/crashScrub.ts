// Removes personal data from a crash report BEFORE it leaves the phone. Pure (no Sentry / React Native imports) so it is
// unit-tested in node (tests/crashScrub.test.ts). Reports keep the error name, message shape, stack and app version; they lose
// who the user is, what they typed, and any token, address, phone number or id that ended up inside a message.

const PATTERNS: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '<jwt>'],
  [/\b(bearer|apikey|api_key|access_token|refresh_token|authorization)(["':=\s]+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1$2<redacted>'],
  [/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, '<key>'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>'],
  [/\+?\d[\d\s().-]{7,}\d/g, '<number>'],
  // Query strings and fragments can carry tokens and search terms.
  [/(https?:\/\/[^\s"'?#]+)[?#][^\s"']*/g, '$1'],
];

export function scrubText(value: string): string {
  let out = value;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

type Json = Record<string, any>;

function scrubDeep(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  const out: Json = {};
  for (const [k, v] of Object.entries(value as Json)) out[k] = scrubDeep(v, depth + 1);
  return out;
}

/** Sentry `beforeSend` / `beforeBreadcrumb` body: returns the cleaned event. Never throws. */
export function scrubEvent<T extends Json>(event: T): T {
  try {
    const e: Json = { ...event };
    delete e.user;
    delete e.request;
    delete e.server_name;
    delete e.extra;
    if (e.contexts && typeof e.contexts === 'object') {
      const { device, os, app, culture, ...rest } = e.contexts as Json;
      void rest;
      // Keep model/OS/app version (needed to reproduce a crash); drop anything that names the owner or their place.
      e.contexts = {
        ...(device ? { device: { model: device.model, family: device.family, arch: device.arch, simulator: device.simulator } } : {}),
        ...(os ? { os: { name: os.name, version: os.version } } : {}),
        ...(app ? { app: { app_version: app.app_version, app_build: app.app_build } } : {}),
        ...(culture ? { culture: { locale: culture.locale } } : {}),
      };
    }
    if (typeof e.message === 'string') e.message = scrubText(e.message);
    if (e.exception?.values) e.exception = { ...e.exception, values: scrubDeep(e.exception.values, 0) };
    if (Array.isArray(e.breadcrumbs)) e.breadcrumbs = e.breadcrumbs.map((b: Json) => scrubBreadcrumb(b));
    if (e.tags) e.tags = scrubDeep(e.tags, 0);
    return e as T;
  } catch {
    // A scrubber that cannot read the event must not let the raw one through.
    return { message: 'event dropped: could not be scrubbed' } as unknown as T;
  }
}

/** Breadcrumbs keep their category and level; the free-text parts are scrubbed and request bodies are dropped. */
export function scrubBreadcrumb<T extends Json>(crumb: T): T {
  const c: Json = { ...crumb };
  if (typeof c.message === 'string') c.message = scrubText(c.message);
  if (c.data && typeof c.data === 'object') {
    const { url, status_code, method } = c.data as Json;
    c.data = { ...(typeof url === 'string' ? { url: scrubText(url) } : {}), ...(status_code !== undefined ? { status_code } : {}), ...(method ? { method } : {}) };
  }
  return c as T;
}
