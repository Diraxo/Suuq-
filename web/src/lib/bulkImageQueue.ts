// Pure rules for the bulk photo queue (migration 0051, workers/image-scan/src/bulk.ts). No platform imports: the Worker
// uses the URL guard and failure classification, the app uses the batch summary for its progress screen.

// ───────────────────────────── which photo links may be fetched at all ─────────────────────────────

const MAX_URL_LENGTH = 2048;
// Names that are never a public photo host. Workers can't reach private address space anyway; this is defence in depth
// and keeps obvious abuse (internal names, IP literals, odd ports) out of the queue.
const BLOCKED_SUFFIXES = ['.local', '.localdomain', '.internal', '.lan', '.home', '.corp', '.intranet', '.onion', '.localhost'];

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: 'not_https' | 'credentials' | 'bad_port' | 'ip_literal' | 'internal_name' | 'malformed' | 'too_long' };

export function validateBulkImageUrl(raw: string): UrlCheck {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'malformed' };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: 'too_long' };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (u.username || u.password || raw.includes('@')) return { ok: false, reason: 'credentials' };
  if (u.port && u.port !== '443') return { ok: false, reason: 'bad_port' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  // The WHATWG parser normalises 0x7f.1, 2130706433, 017700000001 … to dotted-quad, so one IPv4 check covers them.
  if (host.startsWith('[') || host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { ok: false, reason: 'ip_literal' };
  if (!host.includes('.') || host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: 'internal_name' };
  return { ok: true, url: u };
}

// ───────────────────────────── failures: retry or give up ─────────────────────────────

/** Mirrors fail_bulk_row() in 0051: 1, 2, 4, … minutes, capped at an hour. `attempts` = tries so far (≥ 1). */
export const bulkBackoffMinutes = (attempts: number) => Math.min(2 ** Math.max(attempts - 1, 0), 60);

export type BulkFailure = { code: string; retryable: boolean };

/** HTTP statuses worth another try (the host may recover); everything else about a photo link is final. */
export function classifyHttpStatus(status: number): BulkFailure {
  if (status === 408 || status === 425 || status === 429 || status >= 500) return { code: `image_http_${status}`, retryable: true };
  if (status === 404 || status === 410) return { code: 'image_gone', retryable: false };
  if (status === 401 || status === 403) return { code: 'image_forbidden', retryable: false };
  return { code: `image_http_${status}`, retryable: false };
}

// ───────────────────────────── progress for the seller ─────────────────────────────

export type BulkRowStatus = 'queued' | 'processing' | 'ready' | 'ready_review' | 'needs_changes' | 'failed' | 'published' | 'cancelled';
export type BulkCounts = Partial<Record<BulkRowStatus, number>>;

export type BulkSummary = {
  total: number;
  /** still being worked on by the server */
  inProgress: number;
  /** checked, waiting for the app to publish (ready, or ready for staff review) */
  toPublish: number;
  published: number;
  /** the seller can retry these */
  failed: number;
  /** photos were refused — the seller must supply different photos */
  needsChanges: number;
  cancelled: number;
  /** nothing left for the server or the app to do */
  finished: boolean;
  /** whole-number percentage of rows that are no longer waiting on the server */
  percent: number;
};

export function summarizeBatch(counts: BulkCounts): BulkSummary {
  const n = (k: BulkRowStatus) => counts[k] ?? 0;
  const inProgress = n('queued') + n('processing');
  const toPublish = n('ready') + n('ready_review');
  const total = inProgress + toPublish + n('published') + n('failed') + n('needs_changes') + n('cancelled');
  const done = total - inProgress;
  return {
    total,
    inProgress,
    toPublish,
    published: n('published'),
    failed: n('failed'),
    needsChanges: n('needs_changes'),
    cancelled: n('cancelled'),
    finished: inProgress === 0 && toPublish === 0,
    percent: total === 0 ? 0 : Math.floor((done / total) * 100),
  };
}

/** Which way the bulk screen should publish, from the server's photo-check mode (see lib/imageScanPolicy.ts). */
export function chooseBulkPath(policy: { mode: 'off' | 'shadow' | 'enforce' } | null): 'queue' | 'legacy' {
  // Only while photo checks are ENFORCED: below that, held photos would be private (404) and the old direct insert is
  // still the supported path (shadow records it as unverified — that is the evidence the rollout is waiting on).
  return policy?.mode === 'enforce' ? 'queue' : 'legacy';
}
