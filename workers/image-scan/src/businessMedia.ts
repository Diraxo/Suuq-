// Business logo / banner / profile-avatar intake — the only way such an image may reach the PUBLIC bucket.
//
// Pure TypeScript with every side effect injected (same approach as pipeline.ts), unit tested with fakes in
// tests/businessMediaScan.test.ts. Contract differences from the listing scan (pipeline.ts), on purpose:
//   * ONE image per request, kind 'logo' | 'banner'; no listing, category, title or duplicate lookup.
//   * Verdict from the shared decideImage() with the lenient 'business' category: safety (SafeSearch), weapons and
//     third-party-marketplace text still apply; category relevance does not.
//   * NO watermark. A watermark is an anti-theft mark for sale photos; stamping a brand logo would deface it. This is a
//     proposed default awaiting owner confirmation (docs/STOREFRONTS_0054_OWNER_DECISIONS.md).
//   * Fail closed: only an explicit 'pass' is ever published. 'review', 'reject', a provider outage or any storage error
//     publishes nothing. (There is no staff review queue for business media yet, so 'review' is treated as not accepted.)
//   * The DB row is written BEFORE the public object, because migration 0057 refuses to save a business image key that has
//     no 'approved' scan row for its owner — a public object without a row can never be attached to a profile/storefront.

import { checkImageBytes } from '../../../supabase/functions/_shared/imageBytes';
import { jpegMetaReport, needsRotation, stripJpegMetadata } from '../../../lib/jpegMeta';
import { decideImage, type ProviderSignals } from '../../../lib/imageSafety';
import { ScanError, type Deps } from './pipeline';

export type MediaKind = 'logo' | 'banner' | 'avatar';
/** Business slots: the only kinds the backfill (existing public business objects) may touch. */
export const MEDIA_KINDS: readonly MediaKind[] = ['logo', 'banner'];
/** Everything the intake route accepts. 'avatar' is a profile photo: same pipeline, key under avatars/{uid}/ instead of business/. */
export const INTAKE_KINDS: readonly MediaKind[] = ['logo', 'banner', 'avatar'];

/**
 * PUBLIC_BASE_URL is the host every published image URL is built on, and migration 0057/0059 only accepts URLs on a host the operator listed in
 * storefront_media_hosts. An empty/placeholder/non-https value would otherwise yield relative or foreign URLs that the database then refuses
 * only after the object is already public. Refuse up front (fail closed): bare https origin, no credentials, no path, no placeholder.
 */
export function normalizePublicBase(raw: string | null | undefined): string {
  const v = (raw ?? '').trim().replace(/\/$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/.test(v) || /replace/i.test(v) || !v.slice(8).includes('.')) throw new ScanError('internal', 'Invalid public base URL configuration');
  return v;
}

export const MEDIA_LIMITS = { maxBytes: 6 * 1024 * 1024, scansPerHour: 20, visionTimeoutMs: 8000, visionRetries: 1 } as const;

export type MediaStatus = 'approved' | 'rejected' | 'held';

/** What the client receives. No scores, hashes, private keys or provider names. */
export type MediaResult = {
  scanId: string;
  status: MediaStatus;
  /** Present only when approved: the public object key (business/{uid}/{kind}/{uuid}.jpg, or avatars/{uid}/{uuid}.jpg) and its URL. */
  key: string | null;
  url: string | null;
  issues: string[];
};

export type MediaDb = {
  /** Inserts a 'processing' row and returns its id. */
  begin(a: { userId: string; kind: MediaKind; sha256: string }): Promise<{ scanId: string }>;
  recentCount(userId: string, sinceMs: number): Promise<number>;
  /** Final state. 'unavailable' = the check itself failed (nothing published, retryable). */
  finish(a: { scanId: string; status: MediaStatus | 'unavailable'; issues: string[]; sourceKey: string | null; publicKey: string | null; internal: Record<string, unknown> }): Promise<void>;
};

export type MediaDeps = Pick<Deps, 'sha256Hex' | 'uuid' | 'normalize' | 'info' | 'vision' | 'now'> & {
  storage: Pick<Deps['storage'], 'putPrivate' | 'putPublic'>;
  db: MediaDb;
  visionTimeoutMs?: number;
};

/** The only key shape the database accepts for a scanned image (0054 `_sf_image_ok`, 0056 guard, 0059 for avatars). */
export const businessMediaKey = (userId: string, kind: MediaKind, uuid: string) => (kind === 'avatar' ? `avatars/${userId}/${uuid}.jpg` : `business/${userId}/${kind}/${uuid}.jpg`);

async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, retries: number, timeoutMs: number): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await fn(ctl.signal);
    } catch (e) {
      last = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

export async function runBusinessMediaScan(req: { userId: string; kind: unknown; bytes: Uint8Array }, d: MediaDeps): Promise<MediaResult> {
  if (!INTAKE_KINDS.includes(req.kind as MediaKind)) throw new ScanError('bad_request', 'Unknown media kind');
  const kind = req.kind as MediaKind;
  if (req.bytes.length === 0 || req.bytes.length > MEDIA_LIMITS.maxBytes) throw new ScanError('bad_request', 'Image size out of range');

  // 1 ── real file signature, never the client's MIME type or extension
  const check = checkImageBytes(req.bytes, { allowed: ['jpeg', 'png', 'webp'] });
  if (!check.ok) throw new ScanError('unsupported_image', 'Unsupported or damaged image', { reason: check.reason });

  // 2 ── rate limit before any paid call (rejected and failed attempts count)
  if ((await d.db.recentCount(req.userId, d.now() - 3600_000)) >= MEDIA_LIMITS.scansPerHour) throw new ScanError('rate_limited', 'Too many checks; try again later');

  const sha = await d.sha256Hex(req.bytes);
  const { scanId } = await d.db.begin({ userId: req.userId, kind, sha256: sha });

  // Re-check now that our own row exists. The first check above is check-then-insert: N parallel requests all read the same count, all pass,
  // and each would buy a Vision call. Counting after the insert includes our own row, so at most `scansPerHour` requests continue.
  if ((await d.db.recentCount(req.userId, d.now() - 3600_000)) > MEDIA_LIMITS.scansPerHour) {
    await d.db.finish({ scanId, status: 'unavailable', issues: ['rate_limited'], sourceKey: null, publicKey: null, internal: {} }).catch(() => undefined);
    throw new ScanError('rate_limited', 'Too many checks; try again later');
  }

  // 3 ── private original first (nothing public yet), then the upright, metadata-free derivative
  const sourceKey = `orig-media/${req.userId}/${kind}/${sha}.bin`;
  let publicKey: string | null = null;
  let settled = false; // the row already holds a final state that matches what the caller is told
  try {
    await d.storage.putPrivate(sourceKey, req.bytes);
    const norm = await d.normalize(req.bytes);
    // Upright BEFORE stripping: once the EXIF orientation tag is removed a sideways picture would silently stay sideways.
    const before = jpegMetaReport(norm.bytes);
    if (!before.valid || needsRotation(before)) throw new ScanError('internal', 'Normalised image is not an upright JPEG', { orientation: before.orientation, valid: before.valid });
    const stripped = stripJpegMetadata(norm.bytes);
    if (!stripped) throw new ScanError('internal', 'Normalised image is not a readable JPEG');
    const meta = jpegMetaReport(stripped);
    if (!meta.valid || meta.hasExif || meta.hasGps || meta.hasXmp || meta.hasIptc || needsRotation(meta)) throw new ScanError('internal', 'Derivative still carries metadata');
    const dims = await d.info(stripped);
    if (dims.width !== norm.width || dims.height !== norm.height) throw new ScanError('internal', 'Derivative changed size');

    // 4 ── provider analysis; an outage is "unknown", never "safe"
    let signals: ProviderSignals | undefined;
    try {
      signals = await withRetry((signal) => d.vision.analyze(stripped, signal), MEDIA_LIMITS.visionRetries, d.visionTimeoutMs ?? MEDIA_LIMITS.visionTimeoutMs);
    } catch {
      signals = undefined;
    }
    if (!signals) {
      await d.db.finish({ scanId, status: 'unavailable', issues: ['check_failed'], sourceKey, publicKey: null, internal: { providerFailed: true } });
      settled = true;
      throw new ScanError('unavailable', 'Safety check unavailable');
    }

    // 5 ── decision. Only 'pass' is published.
    const verdict = decideImage({ index: 0, signals }, { categoryId: 'business', categoryLabel: 'business', title: '' });
    if (verdict.verdict !== 'pass') {
      const status: MediaStatus = verdict.verdict === 'reject' ? 'rejected' : 'held';
      await d.db.finish({ scanId, status, issues: verdict.issues, sourceKey, publicKey: null, internal: verdict.internal });
      settled = true;
      return { scanId, status, key: null, url: null, issues: verdict.issues };
    }

    // 6 ── record approval, THEN publish (see header)
    publicKey = businessMediaKey(req.userId, kind, d.uuid());
    await d.db.finish({ scanId, status: 'approved', issues: [], sourceKey, publicKey, internal: verdict.internal });
    const url = await d.storage.putPublic(publicKey, stripped); // if this throws, the catch below downgrades the row from 'approved'
    settled = true;
    return { scanId, status: 'approved', key: publicKey, url, issues: [] };
  } catch (e) {
    // Any failure after the row exists leaves it in a final, non-approved state (never 'processing' forever, never
    // 'approved' for an object that was not published).
    if (!settled || publicKey) {
      await d.db.finish({ scanId, status: 'unavailable', issues: ['check_failed'], sourceKey, publicKey: null, internal: { error: String(e).slice(0, 200) } }).catch(() => undefined);
    }
    if (e instanceof ScanError) throw e;
    throw new ScanError('internal', 'Business media intake failed', { error: String(e) });
  }
}

// ── backfill of images uploaded before the scanner existed (migration 0058, scripts/business-media-backfill.mjs) ───────────────────────
// The SAME pipeline as a fresh upload, fed with the bytes of the existing public object. It never touches profiles or storefronts and never
// deletes anything: the caller records the outcome in the database and applies it separately. Reads only keys of the exact business-image
// shape for this owner and slot, so the route cannot be used to read any other object in the bucket.

export type BackfillOutcome =
  | { outcome: 'approved'; scanId: string; key: string; url: string }
  | { outcome: 'rejected' | 'held'; scanId: string }
  | { outcome: 'unavailable' | 'missing' | 'unreadable' };

export type BackfillDeps = MediaDeps & { readPublic(key: string): Promise<Uint8Array | null> };

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const isBusinessImageKey = (key: unknown, ownerId: string, kind: MediaKind): key is string =>
  typeof key === 'string' && new RegExp(`^business/${ownerId}/${kind}/${UUID_RE}\\.jpg$`).test(key);

export async function scanExistingBusinessImage(req: { ownerId: string; kind: unknown; originalKey: unknown }, d: BackfillDeps): Promise<BackfillOutcome> {
  if (!MEDIA_KINDS.includes(req.kind as MediaKind)) throw new ScanError('bad_request', 'Unknown media kind');
  const kind = req.kind as MediaKind;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.ownerId)) throw new ScanError('bad_request', 'Bad owner');
  if (!isBusinessImageKey(req.originalKey, req.ownerId, kind)) throw new ScanError('bad_request', 'Not a business image key for this owner and slot');

  let bytes: Uint8Array | null;
  try {
    bytes = await d.readPublic(req.originalKey);
  } catch {
    return { outcome: 'unavailable' }; // storage hiccup: retryable, nothing decided
  }
  if (!bytes) return { outcome: 'missing' };

  try {
    const r = await runBusinessMediaScan({ userId: req.ownerId, kind, bytes }, d);
    if (r.status === 'approved' && r.key && r.url) return { outcome: 'approved', scanId: r.scanId, key: r.key, url: r.url };
    if (r.status === 'rejected' || r.status === 'held') return { outcome: r.status, scanId: r.scanId };
    return { outcome: 'unavailable' };
  } catch (e) {
    // A file that cannot be read or is the wrong size is permanent; everything else (provider, storage, rate limit) is retryable.
    if (e instanceof ScanError && (e.code === 'unsupported_image' || e.code === 'bad_request')) return { outcome: 'unreadable' };
    return { outcome: 'unavailable' };
  }
}
