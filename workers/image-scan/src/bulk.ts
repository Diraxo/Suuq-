// Bulk photo queue consumer (migration 0051). Pure TypeScript with every side effect injected, so it is unit tested with
// fakes (tests/imageScanBulk.test.ts). NOT DEPLOYED, and does nothing unless BULK_ENABLED=true AND the database
// switch bulk_scan_config.enabled is on — both need owner approval (docs/IMAGE_PARITY_REPORT.md).
//
// One queued row = one listing. For each claimed row the consumer
//   1. downloads every photo through a GUARDED fetcher (https only, no IP literals / internal names / odd ports,
//      redirects re-checked at every hop, hard size cap, timeout, nothing from the remote host is ever shown to anyone),
//   2. runs the SAME scan + watermark pipeline as the interactive flow (runScan) with source = 'bulk',
//   3. records the outcome on the row. It never creates or edits a listing: publication stays the app's guarded write.
//
// Failure handling: network/5xx/429/timeouts and "provider unavailable" are retried with backoff by the database
// (fail_bulk_row) up to max_attempts; a dead link, a non-image, an over-size file or a rejected photo is final.

import { classifyHttpStatus, validateBulkImageUrl, type BulkFailure } from '../../../lib/bulkImageQueue';
import { ScanError, type PublicResult, type ScanRequest } from './pipeline';

export type BulkRow = {
  id: string;
  user_id: string;
  listing_id: string;
  payload: { title?: unknown; description?: unknown; category?: unknown };
  photo_urls: string[];
  attempts: number;
};

export type BulkQueueDb = {
  claim(limit: number): Promise<BulkRow[]>;
  complete(a: { rowId: string; status: 'ready' | 'ready_review' | 'needs_changes'; scanId: string; imageUrls: string[] | null }): Promise<void>;
  fail(rowId: string, code: string, retryable: boolean): Promise<void>;
};

export type FetchLike = (url: string, init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

export type BulkLimits = { maxBytes: number; timeoutMs: number; maxRedirects: number; rowConcurrency: number };
export const BULK_LIMITS: BulkLimits = { maxBytes: 10 * 1024 * 1024, timeoutMs: 10_000, maxRedirects: 3, rowConcurrency: 2 };

export class BulkFetchError extends Error {
  constructor(public failure: BulkFailure) {
    super(failure.code);
  }
}

/** Downloads one photo, or throws BulkFetchError with a retryable/final classification. Never returns a partial body. */
export async function safeFetchImage(fetchFn: FetchLike, rawUrl: string, limits: Partial<BulkLimits> = {}): Promise<Uint8Array> {
  const L = { ...BULK_LIMITS, ...limits };
  let current = rawUrl;
  for (let hop = 0; hop <= L.maxRedirects; hop++) {
    const check = validateBulkImageUrl(current);
    if (!check.ok) throw new BulkFetchError({ code: `image_url_${check.reason}`, retryable: false });

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), L.timeoutMs);
    try {
      let res: Response;
      try {
        res = await fetchFn(check.url.toString(), { redirect: 'manual', signal: ctl.signal, headers: { accept: 'image/*', 'user-agent': 'SuuqiyeImageFetcher/1.0' } });
      } catch (e) {
        throw new BulkFetchError({ code: (e as { name?: string })?.name === 'AbortError' ? 'image_timeout' : 'image_unreachable', retryable: true });
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new BulkFetchError({ code: 'image_redirect_invalid', retryable: false });
        try {
          current = new URL(loc, check.url).toString(); // relative or absolute; re-validated at the top of the loop
        } catch {
          throw new BulkFetchError({ code: 'image_redirect_invalid', retryable: false });
        }
        continue;
      }
      if (res.status !== 200) throw new BulkFetchError(classifyHttpStatus(res.status));
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > L.maxBytes) throw new BulkFetchError({ code: 'image_too_large', retryable: false });
      return await readCapped(res, L.maxBytes, ctl.signal);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new BulkFetchError({ code: 'image_too_many_redirects', retryable: false });
}

async function readCapped(res: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!res.body) throw new BulkFetchError({ code: 'image_empty', retryable: false });
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>;
      try {
        step = await reader.read();
      } catch {
        throw new BulkFetchError({ code: signal.aborted ? 'image_timeout' : 'image_unreachable', retryable: true });
      }
      if (step.done) break;
      total += step.value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new BulkFetchError({ code: 'image_too_large', retryable: false });
      }
      chunks.push(step.value);
    }
  } finally {
    reader.releaseLock?.();
  }
  if (total === 0) throw new BulkFetchError({ code: 'image_empty', retryable: false });
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export type BulkDeps = {
  db: BulkQueueDb;
  fetch: FetchLike;
  /** The interactive pipeline (runScan with real deps) — called with source = 'bulk'. */
  scan(req: ScanRequest): Promise<PublicResult>;
  log?: (event: string, data: Record<string, unknown>) => void;
};

export type BulkRunSummary = { claimed: number; ready: number; readyReview: number; needsChanges: number; retried: number; failed: number };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Processes one claimed row. Never throws: every outcome is written back through db.complete / db.fail. */
export async function processBulkRow(row: BulkRow, d: BulkDeps): Promise<'ready' | 'ready_review' | 'needs_changes' | 'retried' | 'failed'> {
  const log = d.log ?? (() => {});
  const fail = async (f: BulkFailure) => {
    await d.db.fail(row.id, f.code, f.retryable);
    log('bulk-row-failed', { rowId: row.id, code: f.code, retryable: f.retryable });
    return f.retryable ? ('retried' as const) : ('failed' as const);
  };
  try {
    // Fetch one at a time: a row has ≤ 8 photos and the host may rate-limit us.
    const photos: { bytes: Uint8Array }[] = [];
    for (const url of row.photo_urls) photos.push({ bytes: await safeFetchImage(d.fetch, url) });

    const categoryId = str(row.payload.category, 40);
    const title = str(row.payload.title, 200);
    if (!categoryId || !title.trim()) return await fail({ code: 'row_incomplete', retryable: false });

    const result = await d.scan({
      source: 'bulk',
      userId: row.user_id,
      listingId: row.listing_id,
      context: { categoryId, categoryLabel: categoryId, title, description: str(row.payload.description, 5000) },
      photos,
    });

    // The photo provider was unavailable: nothing was judged. Retry later — never publish an unjudged photo.
    if (result.canRetry) return await fail({ code: 'check_unavailable', retryable: true });

    if (result.outcome === 'needs_changes') {
      await d.db.complete({ rowId: row.id, status: 'needs_changes', scanId: result.scanId, imageUrls: null });
      return 'needs_changes';
    }
    const urls = result.images.map((i) => i.url);
    if (!urls.every((u): u is string => !!u)) return await fail({ code: 'derivative_missing', retryable: true });
    const status = result.outcome === 'approved' ? 'ready' : 'ready_review';
    await d.db.complete({ rowId: row.id, status, scanId: result.scanId, imageUrls: urls });
    return status;
  } catch (e) {
    if (e instanceof BulkFetchError) return fail(e.failure);
    if (e instanceof ScanError) {
      if (e.code === 'unsupported_image') return fail({ code: 'image_invalid', retryable: false });
      if (e.code === 'bad_request') return fail({ code: 'row_invalid', retryable: false });
      return fail({ code: e.code === 'in_progress' ? 'scan_in_progress' : `scan_${e.code}`, retryable: true });
    }
    log('bulk-row-error', { rowId: row.id, message: String(e) });
    return fail({ code: 'internal', retryable: true });
  }
}

/** One scheduled run: claim a few rows (the database enforces fairness and the per-user in-flight cap) and process them. */
export async function processBulkQueue(d: BulkDeps, limit: number): Promise<BulkRunSummary> {
  const rows = await d.db.claim(limit);
  const summary: BulkRunSummary = { claimed: rows.length, ready: 0, readyReview: 0, needsChanges: 0, retried: 0, failed: 0 };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(BULK_LIMITS.rowConcurrency, rows.length) }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        let outcome: Awaited<ReturnType<typeof processBulkRow>>;
        try {
          outcome = await processBulkRow(row, d);
        } catch (e) {
          // Even reporting the failure failed (database down?). The row stays 'processing'; its lease expires and it is retried.
          d.log?.('bulk-row-unreported', { rowId: row.id, message: String(e) });
          outcome = 'failed';
        }
        if (outcome === 'ready') summary.ready++;
        else if (outcome === 'ready_review') summary.readyReview++;
        else if (outcome === 'needs_changes') summary.needsChanges++;
        else if (outcome === 'retried') summary.retried++;
        else summary.failed++;
      }
    }),
  );
  return summary;
}
