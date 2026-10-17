// Scan orchestration — pure TypeScript with every side effect injected (`Deps`), so the whole flow is unit
// tested with fakes (tests/imageScanPipeline.test.ts) and the Cloudflare-specific pieces (R2, Images binding,
// Vision, PostgREST) stay thin adapters in the other files.
//
// Order of work for one listing (1–8 photos):
//   1. validate the bytes (real file signature, size, dimensions) — never the client's MIME/extension
//   2. server-side fingerprint → if this exact scan already finished, return it (no provider spend, no new files)
//   3. per-user rate limit (before any paid call)
//   4. per photo, bounded concurrency: keep the private original → normalise → perceptual hash → near-duplicate
//      lookup → provider analysis (timeout + bounded retry; a failure is "unknown", never "safe")
//   5. decideBatch() → one consolidated verdict
//   6. publish watermarked derivatives for photos that may go on (verify each really carries the mark)
//   7. persist and return a SANITISED result

import { checkImageBytes } from '../../../supabase/functions/_shared/imageBytes';
import { jpegMetaReport, needsRotation, stripJpegMetadata } from '../../../lib/jpegMeta';
import {
  decideBatch, dhash, hamming, POLICY, scanFingerprint,
  type BatchResult, type DuplicateMatch, type ImageEvidence, type ListingContext, type ProviderSignals,
} from '../../../lib/imageSafety';

export type PhotoInput = { bytes: Uint8Array };

export type ScanRequest = {
  /** 'bulk' = queued business import (own quota in the database, not the interactive hourly limit). Default 'interactive'. */
  source?: 'interactive' | 'bulk';
  userId: string;
  listingId: string;
  context: ListingContext;
  photos: PhotoInput[];
};

export type Normalized = { bytes: Uint8Array; width: number; height: number };

export type Deps = {
  sha256Hex(bytes: Uint8Array): Promise<string>;
  uuid(): string;
  /** Re-encode to an upright, metadata-free JPEG no larger than the display size. */
  normalize(bytes: Uint8Array): Promise<Normalized>;
  /** Grayscale thumbnail of exactly w×h pixels (row-major). */
  thumbGray(bytes: Uint8Array, w: number, h: number): Promise<Uint8Array>;
  /** Draw the tiled mark onto a normalised JPEG. */
  watermark(norm: Normalized): Promise<Uint8Array>;
  /** Pixel dimensions of an encoded image (read from the bytes, not assumed). */
  info(bytes: Uint8Array): Promise<{ width: number; height: number }>;
  vision: { analyze(bytes: Uint8Array, signal: AbortSignal): Promise<ProviderSignals> };
  storage: {
    putPrivate(key: string, bytes: Uint8Array): Promise<void>;
    putPublic(key: string, bytes: Uint8Array): Promise<string>; // returns the public URL
    publicUrl(key: string): string;
    deletePrivate(key: string): Promise<void>;
  };
  db: {
    /** Insert-or-get the scan job (unique on user+listing+fingerprint). `existing` is set when a finished result is stored. */
    openScan(a: { userId: string; listingId: string; fingerprint: string; category: string; source: 'interactive' | 'bulk' }): Promise<{ scanId: string; existing?: PublicResult }>;
    recentScanCount(userId: string, sinceMs: number): Promise<number>;
    recentDuplicateHits(userId: string, sinceMs: number): Promise<number>;
    findSimilar(phash: string, userId: string, max: number, excludeListing: string): Promise<DuplicateMatch[]>;
    saveResult(a: SaveResult): Promise<void>;
  };
  now(): number;
  /** Test seam; defaults to LIMITS.visionTimeoutMs. */
  visionTimeoutMs?: number;
  /**
   * What happens to the private original of a photo rejected as prohibited/weapon. DEFAULT 'retain' (kept private,
   * staff-only, purged by the normal retention job): deleting is an irreversible retention decision that depends on
   * legal advice about suspected illegal material (docs/IMAGE_SAFETY.md §3), so it is an explicit opt-in.
   */
  rejectedOriginal?: 'retain' | 'delete';
};

export type SaveImage = {
  slot: number; sourceKey: string | null; publicKey: string | null; publicUrl: string | null;
  sha256: string; phash: string; verdict: string; issues: string[]; internal: Record<string, unknown>;
};
export type SaveResult = { scanId: string; userId: string; listingId: string; status: BatchResult['outcome']; flagged: boolean; images: SaveImage[]; result: PublicResult };

/** What the seller's app receives. No keys, hashes, scores or provider names. */
export type PublicResult = {
  scanId: string;
  outcome: BatchResult['outcome'];
  canRetry: boolean;
  issues: BatchResult['issues'];
  images: { slot: number; verdict: 'pass' | 'review' | 'reject'; issues: string[]; url: string | null; held: boolean }[];
};

export class ScanError extends Error {
  constructor(public code: 'bad_request' | 'rate_limited' | 'unsupported_image' | 'in_progress' | 'internal', message: string, public detail?: Record<string, unknown>) {
    super(message);
  }
}

export const LIMITS = { scansPerHour: 20, concurrency: 4, visionTimeoutMs: 8000, visionRetries: 1, duplicateWindowMs: 7 * 24 * 3600_000 } as const;
/** Possibly explicit / weapon imagery waiting for a human: its derivative stays PRIVATE until approval promotes it. */
const SENSITIVE = new Set(['content_uncertain', 'weapon_uncertain', 'check_failed']);

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

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** A derivative "carries the mark" if it is still the same picture but measurably not the same pixels. */
export function markIsPresent(before: Uint8Array, after: Uint8Array): boolean {
  if (before.length !== after.length || before.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < before.length; i++) diff += Math.abs(before[i] - after[i]);
  const mean = diff / before.length;
  return mean >= 0.6 && mean <= 60; // changed (mark visible) but not replaced by something else
}

export async function runScan(req: ScanRequest, d: Deps): Promise<PublicResult> {
  const { photos, context } = req;
  if (photos.length < 1 || photos.length > 8) throw new ScanError('bad_request', 'A listing needs 1–8 photos');

  // 1 ── bytes
  for (const p of photos) {
    const check = checkImageBytes(p.bytes, { allowed: ['jpeg', 'png', 'webp'] });
    if (!check.ok) throw new ScanError('unsupported_image', 'Unsupported or damaged image', { reason: check.reason });
  }
  const shas = await Promise.all(photos.map((p) => d.sha256Hex(p.bytes)));

  // 2 ── idempotency (the fingerprint is computed HERE from the bytes; a client-supplied one is never trusted)
  const fingerprint = scanFingerprint(shas, context);
  const source = req.source ?? 'interactive';
  const { scanId, existing } = await d.db.openScan({ userId: req.userId, listingId: req.listingId, fingerprint, category: context.categoryId, source });
  // A stored answer is final only if it is not a "provider was unavailable, try again" one — otherwise a retry after an
  // outage would be handed the same failure forever and could never recover.
  if (existing && !existing.canRetry) return existing;

  // 3 ── rate limit before any paid call
  // Bulk imports are limited by their own daily photo quota and in-flight cap (migration 0051), not by this interactive allowance.
  if (source === 'interactive' && (await d.db.recentScanCount(req.userId, d.now() - 3600_000)) > LIMITS.scansPerHour) throw new ScanError('rate_limited', 'Too many checks; try again later');

  // 4 ── per-photo evidence
  type Work = { sha: string; norm: Normalized; phash: string; sourceKey: string; evidence: ImageEvidence; gray32: Uint8Array };
  const work = await mapLimit(photos, LIMITS.concurrency, async (p, index): Promise<Work> => {
    const sha = shas[index];
    const sourceKey = `orig/${req.userId}/${req.listingId}/${sha}.bin`;
    await d.storage.putPrivate(sourceKey, p.bytes);
    const norm = await d.normalize(p.bytes);
    // The published pixels must already be upright: metadata is stripped later, so a derivative that still leans
    // on an EXIF orientation tag would end up sideways. Fail closed rather than publish that.
    const meta = jpegMetaReport(norm.bytes);
    if (!meta.valid || needsRotation(meta)) throw new ScanError('internal', 'Normalised image is not an upright JPEG', { slot: index, orientation: meta.orientation, valid: meta.valid });
    const phash = dhash(await d.thumbGray(norm.bytes, 9, 8));
    const gray32 = await d.thumbGray(norm.bytes, 32, 32);
    const duplicates = await d.db.findSimilar(phash, req.userId, POLICY.duplicateMaxDistance, req.listingId);
    let signals: ProviderSignals | undefined;
    let providerFailed = false;
    try {
      signals = await withRetry((signal) => d.vision.analyze(norm.bytes, signal), LIMITS.visionRetries, d.visionTimeoutMs ?? LIMITS.visionTimeoutMs);
    } catch {
      providerFailed = true; // never silently safe
    }
    return { sha, norm, phash, sourceKey, gray32, evidence: { index, signals, providerFailed, duplicates } };
  });

  // within-batch duplicates (same bytes or near-identical hash): the LATER photo is the one flagged
  for (let i = 0; i < work.length; i++) {
    for (let j = 0; j < i; j++) {
      if (work[i].sha === work[j].sha || hamming(work[i].phash, work[j].phash) <= POLICY.batchDuplicateMaxDistance) {
        work[i].evidence.batchDuplicateOf = j;
        break;
      }
    }
  }

  // 5 ── decision
  const recentHits = await d.db.recentDuplicateHits(req.userId, d.now() - LIMITS.duplicateWindowMs);
  const batch = decideBatch(work.map((w) => w.evidence), { ...context, recentDuplicateHits: recentHits });

  // 6 ── derivatives. Mark + verify EVERY publishable photo first, so a failure on photo 5 can't leave
  //      photos 1–4 already published in the public bucket.
  const marked = new Map<number, Uint8Array>();
  for (let i = 0; i < work.length; i++) {
    if (batch.images[i].verdict === 'reject') continue;
    const stamped = await d.watermark(work[i].norm);
    // Strip EXIF/GPS/XMP from the exact bytes we publish (never trust a transform to have done it) and re-read them.
    const bytes = stripJpegMetadata(stamped);
    if (!bytes) throw new ScanError('internal', 'Watermarked image is not a readable JPEG', { slot: i });
    const after = jpegMetaReport(bytes);
    if (!after.valid || after.hasExif || after.hasGps || after.hasXmp || after.hasIptc || needsRotation(after)) {
      throw new ScanError('internal', 'Metadata could not be removed from the derivative', { slot: i });
    }
    // Same picture size as the normalised original — a mark that cropped or resized is a failure.
    const dims = await d.info(bytes);
    if (dims.width !== work[i].norm.width || dims.height !== work[i].norm.height) {
      throw new ScanError('internal', 'Watermarked image changed size', { slot: i, want: [work[i].norm.width, work[i].norm.height], got: [dims.width, dims.height] });
    }
    if (!markIsPresent(work[i].gray32, await d.thumbGray(bytes, 32, 32))) {
      throw new ScanError('internal', 'Watermark verification failed', { slot: i }); // never publish an image we can't prove carries the mark
    }
    marked.set(i, bytes);
  }

  const saved: SaveImage[] = [];
  const out: PublicResult['images'] = [];
  for (let i = 0; i < work.length; i++) {
    const w = work[i];
    const r = batch.images[i];
    let publicKey: string | null = null;
    let publicUrl: string | null = null;
    let sourceKey: string | null = w.sourceKey;
    const internal: Record<string, unknown> = { ...r.internal };

    if (r.verdict === 'reject') {
      // A rejected photo is never republished. Deleting the private original is opt-in (Deps.rejectedOriginal).
      if (d.rejectedOriginal === 'delete' && (r.issues.includes('prohibited_content') || r.issues.includes('weapon'))) {
        await d.storage.deletePrivate(w.sourceKey);
        sourceKey = null;
        internal.originalDeleted = true;
      }
    } else {
      const finalKey = `wm/listings/${req.userId}/${req.listingId}/${d.uuid()}.jpg`;
      publicKey = finalKey;
      if (r.issues.some((c) => SENSITIVE.has(c))) {
        await d.storage.putPrivate(`pending/${finalKey}`, marked.get(i)!);
        publicUrl = d.storage.publicUrl(finalKey);
      } else {
        publicUrl = await d.storage.putPublic(finalKey, marked.get(i)!);
      }
    }
    saved.push({ slot: i, sourceKey, publicKey, publicUrl, sha256: w.sha, phash: w.phash, verdict: r.verdict, issues: r.issues, internal });
    // `held`: the derivative is still private (possibly sensitive imagery awaiting a human); its URL goes live
    // only after staff approve and /v1/promote copies it. The app needs the URL to publish the (hidden) listing.
    const held = r.verdict !== 'reject' && r.issues.some((c) => SENSITIVE.has(c));
    out.push({ slot: i, verdict: r.verdict, issues: r.issues, url: r.verdict === 'reject' ? null : publicUrl, held });
  }

  // 7 ── persist + sanitised answer
  const result: PublicResult = { scanId, outcome: batch.outcome, canRetry: batch.canRetry, issues: batch.issues, images: out };
  await d.db.saveResult({ scanId, userId: req.userId, listingId: req.listingId, status: batch.outcome, flagged: batch.flagForStaff, images: saved, result });
  return result;
}

/** Promote a held derivative (private `pending/<key>`) to the public bucket after staff approval. */
export async function promoteHeld(
  a: { publicKey: string; reviewApproved: boolean },
  d: Pick<Deps, 'storage'> & { storage: Deps['storage'] & { getPrivate(key: string): Promise<Uint8Array | null>; deletePrivate(key: string): Promise<void> } },
): Promise<string> {
  if (!a.reviewApproved) throw new ScanError('bad_request', 'Photo is not approved');
  if (!/^wm\/listings\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}\.jpg$/.test(a.publicKey)) throw new ScanError('bad_request', 'Bad key');
  const bytes = await d.storage.getPrivate(`pending/${a.publicKey}`);
  if (!bytes) throw new ScanError('bad_request', 'Nothing held for this photo');
  const url = await d.storage.putPublic(a.publicKey, bytes);
  await d.storage.deletePrivate(`pending/${a.publicKey}`);
  return url;
}
