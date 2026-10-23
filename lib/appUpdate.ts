// Mandatory-update policy: pure parsing, semantic-version comparison and the block/allow decision.
// No React Native imports on purpose, so the whole decision table is unit-tested (tests/appUpdate.test.ts).
//
// Failure policy (documented in docs/MANDATORY_UPDATES.md):
//   - a policy was fetched and the installed version is below its minimum  -> BLOCK
//   - the fetch failed but a previously fetched policy is cached           -> decide from the cached policy (a block stays a block)
//   - the fetch failed and nothing is cached                               -> ALLOW, marked "unverified", retried with back-off
//   - the installed version cannot be read or parsed                      -> ALLOW, marked "unverified" (cannot prove it is old)
// A failed request is never treated as proof that the install is current: it is reported as `unverified`, not `ok`.

export type UpdatePlatform = 'ios' | 'android';

export type UpdatePolicy = {
  platform: UpdatePlatform;
  enabled: boolean;
  recommendedVersion: string | null;
  minimumVersion: string;
  storeUrl: string | null;
  /** Operator-written message per language code (e.g. { en, so, am }); the app's own translated copy is used when absent. */
  message: Record<string, string>;
};

export type UpdateDecision =
  | { kind: 'ok' }
  | { kind: 'recommended'; recommendedVersion: string }
  | { kind: 'required'; minimumVersion: string; storeUrl: string | null; message: Record<string, string> }
  | { kind: 'unverified'; reason: 'no-policy' | 'bad-installed-version' };

const SEMVER = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/;

/** "1.10.0" -> [1, 10, 0]. Strict three-part numeric versions only; anything else is null. */
export function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const m = SEMVER.exec(value.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Numeric comparison per component (so 1.10.0 > 1.9.0). Returns -1, 0, 1, or null when either side is not a valid version. */
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

// Only the official store listings can ever be opened from the update screen, whatever the database row says.
const IOS_HOSTS = ['apps.apple.com', 'itunes.apple.com'];
const ANDROID_HOSTS = ['play.google.com'];

/** True for a listing URL on the platform's own store: https on the store host, or the store's app scheme (itms-apps / market). */
export function isOfficialStoreUrl(platform: UpdatePlatform, url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 500) return false;
  const m = /^(https|itms-apps|itms-appss|market):\/\/([^/?#:]+)/i.exec(url.trim());
  if (!m) return false;
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase();
  if (platform === 'android') return scheme === 'market' ? host === 'details' : scheme === 'https' && ANDROID_HOSTS.includes(host);
  return (scheme === 'https' || scheme.startsWith('itms-apps')) && IOS_HOSTS.includes(host);
}

/**
 * Validates one `app_update_policy` row. Returns null for anything malformed (wrong platform, bad versions, non-official store URL),
 * so a corrupt row can never block users with a nonsense minimum and never silently passes as a valid policy.
 */
export function parsePolicyRow(row: unknown, platform: UpdatePlatform): UpdatePolicy | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (r.platform !== platform) return null;
  if (typeof r.enabled !== 'boolean') return null;
  if (!parseVersion(r.minimum_version)) return null;
  if (r.recommended_version != null && !parseVersion(r.recommended_version)) return null;
  if (r.store_url != null && r.store_url !== '' && !isOfficialStoreUrl(platform, r.store_url)) return null;
  const message: Record<string, string> = {};
  if (r.message && typeof r.message === 'object' && !Array.isArray(r.message)) {
    for (const [lang, text] of Object.entries(r.message as Record<string, unknown>)) {
      if (typeof text === 'string' && text.trim() && text.length <= 500) message[lang] = text.trim();
    }
  }
  return {
    platform,
    enabled: r.enabled,
    recommendedVersion: r.recommended_version == null ? null : String(r.recommended_version).trim(),
    minimumVersion: String(r.minimum_version).trim(),
    storeUrl: r.store_url == null || r.store_url === '' ? null : String(r.store_url).trim(),
    message,
  };
}

/** The decision for an installed version against a (possibly absent) policy. */
export function decideUpdate(installedVersion: string | null | undefined, policy: UpdatePolicy | null): UpdateDecision {
  if (!policy) return { kind: 'unverified', reason: 'no-policy' };
  if (!policy.enabled) return { kind: 'ok' };
  if (!parseVersion(installedVersion)) return { kind: 'unverified', reason: 'bad-installed-version' };
  if (compareVersions(installedVersion, policy.minimumVersion) === -1) {
    return { kind: 'required', minimumVersion: policy.minimumVersion, storeUrl: policy.storeUrl, message: policy.message };
  }
  if (policy.recommendedVersion && compareVersions(installedVersion, policy.recommendedVersion) === -1) {
    return { kind: 'recommended', recommendedVersion: policy.recommendedVersion };
  }
  return { kind: 'ok' };
}

/** The operator's message in the user's language (then English), or null so the built-in translated copy is used. */
export function pickMessage(message: Record<string, string>, language: string): string | null {
  return message[language] ?? message.en ?? null;
}

/** Where "Update now" goes: the policy's listing URL, else a safe default. The iOS default only opens the App Store app (the app id is not known to the repo). */
export function resolveStoreUrl(platform: UpdatePlatform, policyUrl: string | null): string {
  if (policyUrl && isOfficialStoreUrl(platform, policyUrl)) return policyUrl;
  return platform === 'android' ? 'https://play.google.com/store/apps/details?id=suuqiye.com' : 'https://apps.apple.com/';
}
