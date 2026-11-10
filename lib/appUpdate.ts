// App-update policy: pure parsing, semantic-version comparison and the single update decision.
// No React Native imports on purpose, so the whole decision table is unit-tested (tests/appUpdate.test.ts).
//
// Three release types (docs/MANDATORY_UPDATES.md):
//   normal    -> dismissible reminder           (default reminder every 72 h)
//   important -> prominent announcement         (default reminder every 24 h), blocks only if the release is marked mandatory
//   critical  -> mandatory, non-dismissible gate (a critical release is ALWAYS mandatory, in the database and here)
// A policy without a linked release still works exactly as before: `minimum_version` blocks, `recommended_version` is a normal reminder.
//
// Failure policy:
//   - a policy was fetched and the installed version is below the effective minimum  -> BLOCK
//   - the fetch failed but a previously fetched policy is cached                     -> decide from the cached policy (a block stays a block)
//   - the fetch failed and nothing is cached                                         -> ALLOW, marked "unverified", retried with back-off
//   - the installed version cannot be read or parsed                                 -> ALLOW, marked "unverified" (cannot prove it is old)
// A failed request is never treated as proof that the install is current: it is reported as `unverified`, not `ok`.

export type UpdatePlatform = 'ios' | 'android';
export type ReleaseType = 'normal' | 'important' | 'critical';

/** Icons an operator may name in a changelog. Anything else falls back to DEFAULT_CHANGELOG_ICON; no database value is ever rendered as a component. */
export const CHANGELOG_ICONS = {
  image: 'image-outline',
  'message-circle': 'chatbubble-ellipses-outline',
  shield: 'shield-checkmark-outline',
  zap: 'flash-outline',
  search: 'search-outline',
  bell: 'notifications-outline',
  heart: 'heart-outline',
  tag: 'pricetag-outline',
  'map-pin': 'location-outline',
  star: 'star-outline',
  user: 'person-outline',
  lock: 'lock-closed-outline',
  camera: 'camera-outline',
  settings: 'settings-outline',
  bug: 'bug-outline',
  rocket: 'rocket-outline',
  sparkles: 'sparkles-outline',
  store: 'storefront-outline',
  share: 'share-social-outline',
  wallet: 'wallet-outline',
} as const;
export type ChangelogIconKey = keyof typeof CHANGELOG_ICONS;
export type ChangelogIconName = (typeof CHANGELOG_ICONS)[ChangelogIconKey] | 'sparkles-outline';
export const DEFAULT_CHANGELOG_ICON: ChangelogIconName = 'sparkles-outline';

export function resolveChangelogIcon(key: unknown): ChangelogIconName {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(CHANGELOG_ICONS, key) ? CHANGELOG_ICONS[key as ChangelogIconKey] : DEFAULT_CHANGELOG_ICON;
}

export type ChangelogItem = { title: string; description: string; icon: ChangelogIconName };

/** Per-language overrides of an operator-written release: index-aligned with the base changelog items. */
export type ReleaseTranslation = { title?: string; description?: string; items?: { title?: string; description?: string }[] };

export type UpdateRelease = {
  id: string;
  version: string;
  versionCode: number | null;
  releaseType: ReleaseType;
  title: string;
  description: string;
  changelog: ChangelogItem[];
  translations: Record<string, ReleaseTranslation>;
  mandatory: boolean;
  minimumSupportedVersion: string | null;
  targetVersion: string;
  /** The store listing for THIS platform (validated); null when the release has none. */
  storeUrl: string | null;
  supportUrl: string | null;
  expiresAt: string | null;
};

export type UpdatePolicy = {
  platform: UpdatePlatform;
  enabled: boolean;
  recommendedVersion: string | null;
  minimumVersion: string;
  storeUrl: string | null;
  /** Operator-written message per language code (e.g. { en, so, am }); the app's own translated copy is used when absent. */
  message: Record<string, string>;
  /** Hours between reminders; null = the release type's default (normal 72, important 24). */
  reminderIntervalHours: number | null;
  /** Hours to wait after an update is first seen before the first reminder (0 = immediately). */
  firstReminderDelayHours: number;
  showWhatsNew: boolean;
  supportUrl: string | null;
  /** The linked, published, platform-matching release (embedded from `current_release_id`); null when none. */
  release: UpdateRelease | null;
};

/** What the user is told about a dismissible update. */
export type OptionalUpdate = {
  kind: 'optional';
  /** 'important' is the prominent announcement; 'normal' the routine reminder. */
  tier: 'normal' | 'important';
  targetVersion: string;
  release: UpdateRelease | null;
  storeUrl: string | null;
  reminderIntervalHours: number;
  firstReminderDelayHours: number;
  showWhatsNew: boolean;
};

export type RequiredUpdate = {
  kind: 'required';
  minimumVersion: string;
  /** The version to install; falls back to the minimum when no release says otherwise. */
  targetVersion: string;
  release: UpdateRelease | null;
  storeUrl: string | null;
  supportUrl: string | null;
  message: Record<string, string>;
};

/**
 * ok          -> nothing to show                                        (spec: none)
 * optional    -> dismissible reminder / announcement                    (spec: normal_reminder | important_announcement, by `tier`)
 * required    -> full-screen mandatory gate                             (spec: mandatory_update)
 * unverified  -> could not determine; allowed, retried                  (spec: temporarily_unavailable)
 */
export type UpdateDecision = { kind: 'ok' } | OptionalUpdate | RequiredUpdate | { kind: 'unverified'; reason: 'no-policy' | 'bad-installed-version' };

export const DEFAULT_REMINDER_HOURS: Record<'normal' | 'important', number> = { normal: 72, important: 24 };

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

/** A support destination the app will open: https or mailto only (never javascript:, intent:, file:, custom schemes). */
export function isSafeSupportUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length <= 500 && /^(https:\/\/[^\s/?#]+|mailto:[^\s@]+@[^\s@]+)/i.test(url.trim());
}

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);

/** Validates the changelog JSON. Malformed items are dropped (never rendered); at most 20 items. Icons come only from the safe map. */
export function parseChangelog(value: unknown): ChangelogItem[] {
  const items = value && typeof value === 'object' && !Array.isArray(value) ? (value as { items?: unknown }).items : null;
  if (!Array.isArray(items)) return [];
  const out: ChangelogItem[] = [];
  for (const raw of items.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const title = text(r.title, 80);
    if (!title) continue;
    out.push({ title, description: text(r.description, 300) ?? '', icon: resolveChangelogIcon(r.icon) });
  }
  return out;
}

function parseTranslations(value: unknown): Record<string, ReleaseTranslation> {
  const out: Record<string, ReleaseTranslation> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [lang, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z]{2,3}$/.test(lang) || !raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const tr: ReleaseTranslation = {};
    const title = text(r.title, 120);
    const description = text(r.description, 2000);
    if (title) tr.title = title;
    if (description) tr.description = description;
    if (Array.isArray(r.items)) {
      tr.items = r.items.slice(0, 20).map((it) => {
        const i = it && typeof it === 'object' ? (it as Record<string, unknown>) : {};
        const t = text(i.title, 80);
        const d = text(i.description, 300);
        return { ...(t ? { title: t } : {}), ...(d ? { description: d } : {}) };
      });
    }
    out[lang] = tr;
  }
  return out;
}

/** Validates one embedded `app_releases` row for `platform`. Null for anything malformed, unpublished, or aimed at the other platform. */
export function parseReleaseRow(row: unknown, platform: UpdatePlatform): UpdateRelease | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (r.platform !== platform && r.platform !== 'all') return null;
  if (r.published !== true) return null;
  if (r.release_type !== 'normal' && r.release_type !== 'important' && r.release_type !== 'critical') return null;
  if (!parseVersion(r.version) || !parseVersion(r.target_version)) return null;
  if (r.minimum_supported_version != null && !parseVersion(r.minimum_supported_version)) return null;
  const title = text(r.title, 120);
  const description = text(r.description, 2000);
  if (!title || !description) return null;
  const rawStore = platform === 'android' ? r.android_store_url : r.ios_store_url;
  const releaseType = r.release_type;
  return {
    id: r.id,
    version: String(r.version).trim(),
    versionCode: typeof r.version_code === 'number' && Number.isInteger(r.version_code) && r.version_code > 0 ? r.version_code : null,
    releaseType,
    title,
    description,
    changelog: parseChangelog(r.changelog),
    translations: parseTranslations(r.translations),
    // A critical release is mandatory whatever the flag says: a contradictory row can never downgrade to optional.
    mandatory: r.mandatory === true || releaseType === 'critical',
    minimumSupportedVersion: r.minimum_supported_version == null ? null : String(r.minimum_supported_version).trim(),
    targetVersion: String(r.target_version).trim(),
    storeUrl: isOfficialStoreUrl(platform, rawStore) ? rawStore.trim() : null,
    supportUrl: isSafeSupportUrl(r.support_url) ? r.support_url.trim() : null,
    expiresAt: typeof r.expires_at === 'string' && !Number.isNaN(Date.parse(r.expires_at)) ? r.expires_at : null,
  };
}

/**
 * Validates one `app_update_policy` row. Returns null for anything malformed (wrong platform, bad versions, non-official store URL),
 * so a corrupt row can never block users with a nonsense minimum and never silently passes as a valid policy.
 * Rows from before migration 0090 (no new columns) parse with defaults; a malformed embedded release is ignored, not fatal.
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
    for (const [lang, t] of Object.entries(r.message as Record<string, unknown>)) {
      if (typeof t === 'string' && t.trim() && t.length <= 500) message[lang] = t.trim();
    }
  }
  const hours = (v: unknown, min: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 8760 ? v : null);
  const embedded = Array.isArray(r.release) ? r.release[0] : r.release;
  return {
    platform,
    enabled: r.enabled,
    recommendedVersion: r.recommended_version == null ? null : String(r.recommended_version).trim(),
    minimumVersion: String(r.minimum_version).trim(),
    storeUrl: r.store_url == null || r.store_url === '' ? null : String(r.store_url).trim(),
    message,
    reminderIntervalHours: hours(r.reminder_interval_hours, 1),
    firstReminderDelayHours: hours(r.first_reminder_delay_hours, 0) ?? 0,
    showWhatsNew: r.show_whats_new !== false,
    supportUrl: isSafeSupportUrl(r.support_url) ? r.support_url.trim() : null,
    release: parseReleaseRow(embedded, platform),
  };
}

export type DecideContext = {
  /** Installed native build number (Android versionCode) when known. */
  installedBuild?: number | null;
  /** Clock for release expiry; defaults to Date.now(). */
  now?: number;
};

/** True while a release may be announced: not expired. (Unpublished / wrong-platform rows never parse into a release.) */
export function isReleaseActive(release: UpdateRelease | null, now: number): release is UpdateRelease {
  if (!release) return false;
  if (release.expiresAt && Date.parse(release.expiresAt) <= now) return false;
  return true;
}

/** The decision for an installed version against a (possibly absent) policy. */
export function decideUpdate(installedVersion: string | null | undefined, policy: UpdatePolicy | null, ctx: DecideContext = {}): UpdateDecision {
  if (!policy) return { kind: 'unverified', reason: 'no-policy' };
  if (!policy.enabled) return { kind: 'ok' };
  if (!parseVersion(installedVersion)) return { kind: 'unverified', reason: 'bad-installed-version' };
  const now = ctx.now ?? Date.now();
  const release = isReleaseActive(policy.release, now) ? policy.release : null;
  const storeUrl = release?.storeUrl ?? policy.storeUrl;

  // Effective minimum: the policy's own minimum, raised by an active mandatory/critical release. A mandatory release without an explicit
  // minimum_supported_version requires its target version. The higher of the two always wins, so nothing can lower a block.
  let minimum = policy.minimumVersion;
  let requiredTarget: string | null = null;
  if (release && (release.mandatory || release.releaseType === 'critical')) {
    const releaseMin = release.minimumSupportedVersion ?? release.targetVersion;
    if (compareVersions(releaseMin, minimum) === 1) minimum = releaseMin;
    requiredTarget = release.targetVersion;
  }
  if (compareVersions(installedVersion, minimum) === -1) {
    const target = requiredTarget && compareVersions(requiredTarget, minimum) !== -1 ? requiredTarget : minimum;
    return {
      kind: 'required',
      minimumVersion: minimum,
      targetVersion: target,
      release,
      storeUrl,
      supportUrl: release?.supportUrl ?? policy.supportUrl,
      message: policy.message,
    };
  }

  // Optional: the release's target, else the policy's recommended version. Equal marketing version with an older Android build also counts.
  const target = release ? release.targetVersion : policy.recommendedVersion;
  if (!target) return { kind: 'ok' };
  const cmp = compareVersions(installedVersion, target);
  const olderBuild = cmp === 0 && release?.versionCode != null && ctx.installedBuild != null && ctx.installedBuild < release.versionCode;
  if (cmp !== -1 && !olderBuild) return { kind: 'ok' };
  const tier: 'normal' | 'important' = release && release.releaseType !== 'normal' ? 'important' : 'normal';
  return {
    kind: 'optional',
    tier,
    targetVersion: target,
    release,
    storeUrl,
    reminderIntervalHours: policy.reminderIntervalHours ?? DEFAULT_REMINDER_HOURS[tier],
    firstReminderDelayHours: policy.firstReminderDelayHours,
    showWhatsNew: policy.showWhatsNew,
  };
}

/** A release's title/description/changelog in the user's language; base text where no override exists. */
export function localizeRelease(release: UpdateRelease, language: string): { title: string; description: string; changelog: ChangelogItem[] } {
  const tr = release.translations[language];
  return {
    title: tr?.title ?? release.title,
    description: tr?.description ?? release.description,
    changelog: release.changelog.map((item, i) => ({
      ...item,
      title: tr?.items?.[i]?.title ?? item.title,
      description: tr?.items?.[i]?.description ?? item.description,
    })),
  };
}

/** The operator's message in the user's language (then English), or null so the built-in translated copy is used. */
export function pickMessage(message: Record<string, string>, language: string): string | null {
  return message[language] ?? message.en ?? null;
}

/** Where "Update now" goes: the release/policy listing URL, else a safe default. The iOS default only opens the App Store app (the app id is not known to the repo). */
export function resolveStoreUrl(platform: UpdatePlatform, policyUrl: string | null): string {
  if (policyUrl && isOfficialStoreUrl(platform, policyUrl)) return policyUrl;
  return platform === 'android' ? 'https://play.google.com/store/apps/details?id=suuqiye.com' : 'https://apps.apple.com/';
}

/** The database row shape of a parsed policy, for the on-device cache. `parsePolicyRow(policyToRow(p), p.platform)` equals `p` (tested). */
export function policyToRow(p: UpdatePolicy): Record<string, unknown> {
  const r = p.release;
  return {
    platform: p.platform,
    enabled: p.enabled,
    recommended_version: p.recommendedVersion,
    minimum_version: p.minimumVersion,
    store_url: p.storeUrl,
    message: p.message,
    reminder_interval_hours: p.reminderIntervalHours,
    first_reminder_delay_hours: p.firstReminderDelayHours,
    show_whats_new: p.showWhatsNew,
    support_url: p.supportUrl,
    release: r
      ? {
          id: r.id,
          platform: p.platform,
          version: r.version,
          version_code: r.versionCode,
          release_type: r.releaseType,
          title: r.title,
          description: r.description,
          changelog: { items: r.changelog.map((i) => ({ title: i.title, description: i.description, icon: (Object.keys(CHANGELOG_ICONS) as ChangelogIconKey[]).find((k) => CHANGELOG_ICONS[k] === i.icon) ?? 'sparkles' })) },
          translations: r.translations,
          mandatory: r.mandatory,
          minimum_supported_version: r.minimumSupportedVersion,
          target_version: r.targetVersion,
          android_store_url: p.platform === 'android' ? r.storeUrl : null,
          ios_store_url: p.platform === 'ios' ? r.storeUrl : null,
          support_url: r.supportUrl,
          published: true,
          expires_at: r.expiresAt,
        }
      : null,
  };
}
