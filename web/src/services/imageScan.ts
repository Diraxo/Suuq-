// Network side of the listing photo check on the website — the browser twin of lib/imageScan.ts on mobile. The DECISION
// (safe or not, watermarked or not, which URL gets published) is made entirely by the scan Worker (workers/image-scan);
// this only posts the photos to it and returns its answer, so web and mobile follow exactly the same server rules.
//
// Photos are the JPEGs the Sell/Edit pickers already validated and re-encoded (services/imagePrep.ts). Each is posted as a
// multipart field; nothing is uploaded to the public bucket from the browser on this path.
import { supabase } from '@/lib/supabase';
import { createScanRunner, type ScanResult } from '@/lib/imageScanState';
import { choosePublishPath, parsePolicy, type PublishPath, type ScanBlockKind, type ScanClientPolicy } from '@/lib/imageScanPolicy';

const BASE_URL = (process.env.NEXT_PUBLIC_IMAGE_SCAN_URL ?? '').replace(/\/$/, '');
const TIMEOUT_MS = 90_000;

export const imageScanEnabled = BASE_URL.length > 0;

export type ImageScanFailure = 'offline' | 'timeout' | 'rate_limited' | 'busy' | 'unreadable' | 'failed' | ScanBlockKind;
export class ImageScanError extends Error {
  constructor(public kind: ImageScanFailure) {
    super(kind);
  }
}

export type ScanPhoto = { id: string; file: Blob };
export type WebScanInput = { listingId: string; categoryId: string; title: string; description: string; photos: ScanPhoto[] };

// The shared runner (lib/imageScanState.ts) keys its cache on "photo uris": here those are the photos' stable ids. The
// bytes for an id are looked up when the request actually runs.
const files = new Map<string, Blob>();

async function post(input: { listingId: string; categoryId: string; title: string; description: string; photoUris: string[] }, signal?: AbortSignal): Promise<ScanResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ImageScanError('failed');

  const form = new FormData();
  form.append('listingId', input.listingId);
  form.append('categoryId', input.categoryId);
  form.append('title', input.title);
  form.append('description', input.description);
  input.photoUris.forEach((id, i) => {
    const blob = files.get(id);
    if (!blob) throw new ImageScanError('failed');
    form.append(`photo${i}`, blob, `photo${i}.jpg`);
  });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => ctl.abort());
  try {
    const res = await fetch(`${BASE_URL}/v1/scans`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form, signal: ctl.signal });
    if (res.ok) return (await res.json()) as ScanResult;
    if (res.status === 429) throw new ImageScanError('rate_limited');
    if (res.status === 409) throw new ImageScanError('busy');
    if (res.status === 422) throw new ImageScanError('unreadable');
    throw new ImageScanError('failed');
  } catch (e) {
    if (e instanceof ImageScanError) throw e;
    if ((e as { name?: string })?.name === 'AbortError') throw new ImageScanError('timeout');
    throw new ImageScanError('offline');
  } finally {
    clearTimeout(timer);
  }
}

const runner = createScanRunner(post);

/** Checks the given photos of one listing together. Identical unchanged requests reuse the previous answer. */
export function scanListingPhotos(input: WebScanInput, signal?: AbortSignal): Promise<ScanResult> {
  for (const p of input.photos) files.set(p.id, p.file);
  return runner.scan({ listingId: input.listingId, categoryId: input.categoryId, title: input.title, description: input.description, photoUris: input.photos.map((p) => p.id) }, signal);
}
export const resetScanCache = () => {
  runner.invalidate();
  files.clear();
};

// ── server-driven rollout policy (migration 0050) ────────────────────────────────────────────────────────────────
const POLICY_TTL_MS = 60_000;
let cachedPolicy: { at: number; policy: ScanClientPolicy | null } | null = null;
export const peekScanPolicy = () => cachedPolicy?.policy ?? null;

export async function fetchScanPolicy(force = false): Promise<ScanClientPolicy | null> {
  if (!force && cachedPolicy && Date.now() - cachedPolicy.at < POLICY_TTL_MS) return cachedPolicy.policy;
  let policy: ScanClientPolicy | null = null;
  try {
    const { data, error } = await supabase.rpc('image_scan_client_policy');
    policy = error ? null : parsePolicy(data);
  } catch {
    policy = null;
  }
  cachedPolicy = { at: Date.now(), policy };
  return policy;
}

/** How this site may publish photos right now: legacy upload, the scan service, or stop with a "refresh / update" message. */
export async function decidePublishPath(): Promise<PublishPath> {
  return choosePublishPath(await fetchScanPolicy(), imageScanEnabled);
}
