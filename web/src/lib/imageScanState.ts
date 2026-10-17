// Pure client-side state for the listing photo check: cache by content, in-flight de-duplication, and the
// mapping from a scan result to what the screen shows. No React Native imports → unit tested in node.

import { fnv1a, type BatchResult, type IssueCode } from './imageSafety';

export type ScanImage = { slot: number; verdict: 'pass' | 'review' | 'reject'; issues: string[]; url: string | null; held: boolean };
export type ScanResult = { scanId: string; outcome: BatchResult['outcome']; canRetry: boolean; issues: BatchResult['issues']; images: ScanImage[] };

export type ScanInput = { listingId: string; categoryId: string; title: string; description: string; photoUris: string[] };

/**
 * Same photos (by picked-file uri, in any order), same category/title/description → same key → the previous
 * answer is reused. Navigating back and forth through the Sell steps therefore never re-scans; changing a
 * photo, the category or the title does. (The Worker repeats this check on the real bytes, so a reused uri
 * with different content can at worst cost one extra server-side lookup — never skip a check.)
 */
export function scanKey(input: ScanInput): string {
  return fnv1a([[...input.photoUris].sort().join('|'), input.listingId, input.categoryId, input.title.trim().toLowerCase(), input.description.trim().toLowerCase()].join('\u0001'));
}

/** Only finished results are cached; a retry-able failure is never remembered as the answer. */
export function isCacheable(r: ScanResult): boolean {
  return !r.canRetry;
}

export function createScanRunner(run: (input: ScanInput, signal?: AbortSignal) => Promise<ScanResult>, maxEntries = 12) {
  const cache = new Map<string, ScanResult>();
  const inflight = new Map<string, Promise<ScanResult>>();
  return {
    /** Returns the cached result, joins an identical in-flight request, or starts one. */
    scan(input: ScanInput, signal?: AbortSignal): Promise<ScanResult> {
      const key = scanKey(input);
      const hit = cache.get(key);
      if (hit) return Promise.resolve(hit);
      const running = inflight.get(key);
      if (running) return running;
      const p = run(input, signal)
        .then((r) => {
          if (isCacheable(r)) {
            cache.set(key, r);
            if (cache.size > maxEntries) cache.delete(cache.keys().next().value as string);
          }
          return r;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    invalidate() {
      cache.clear();
    },
    peek(input: ScanInput) {
      return cache.get(scanKey(input));
    },
  };
}

/** Photos the seller has to change. Photos that passed (or only need review) are left untouched. */
export function photosToFix(r: ScanResult): number[] {
  return r.images.filter((i) => i.verdict === 'reject').map((i) => i.slot);
}

export type IssueRow = { code: IssueCode; titleKey: string; messageKey: string; photos: number[]; severity: 'fix' | 'review' };

/** One row per distinct problem (never per photo), photo numbers 1-based for display. */
export function issueRows(r: ScanResult): IssueRow[] {
  return r.issues.map((i) => ({
    code: i.code,
    titleKey: `imageScan.issue.${i.code}.title`,
    messageKey: `imageScan.issue.${i.code}.message`,
    photos: i.indexes.map((n) => n + 1),
    severity: i.severity,
  }));
}

/** The photos to publish with, in the seller's order. Only valid for outcomes that may proceed. */
export function publishableUrls(r: ScanResult): string[] | null {
  if (r.outcome === 'needs_changes') return null;
  const urls = r.images.map((i) => i.url);
  return urls.every((u): u is string => !!u) ? (urls as string[]) : null;
}

/** R2 object key of a published derivative (kept alongside the URL so the listing's images can be deleted later). */
export function keyFromUrl(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return url;
  }
}
