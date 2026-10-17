// Network side of the listing photo check. The decision is made by the scan Worker (workers/image-scan);
// this only uploads the photos to it and returns its answer. Disabled unless EXPO_PUBLIC_IMAGE_SCAN_URL is set,
// so builds without the Worker deployed keep the existing publish path untouched.

import { supabase } from '@/lib/supabase';
import { resizeAndCompress } from '@/lib/imagePipeline';
import { createScanRunner, type ScanInput, type ScanResult } from '@/lib/imageScanState';
import { choosePublishPath, parsePolicy, type PublishPath, type ScanBlockKind, type ScanClientPolicy } from '@/lib/imageScanPolicy';

const BASE_URL = (process.env.EXPO_PUBLIC_IMAGE_SCAN_URL ?? '').replace(/\/$/, '');
const TIMEOUT_MS = 90_000;

let cachedPolicy: { at: number; policy: ScanClientPolicy | null } | null = null;
export const peekScanPolicy = () => cachedPolicy?.policy ?? null;

export const imageScanEnabled = BASE_URL.length > 0;

export type ImageScanFailure = 'offline' | 'timeout' | 'rate_limited' | 'busy' | 'unreadable' | 'failed' | ScanBlockKind;
export class ImageScanError extends Error {
  constructor(public kind: ImageScanFailure) {
    super(kind);
  }
}

async function post(input: ScanInput, signal?: AbortSignal): Promise<ScanResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ImageScanError('failed');

  const form = new FormData();
  form.append('listingId', input.listingId);
  form.append('categoryId', input.categoryId);
  form.append('title', input.title);
  form.append('description', input.description);
  for (let i = 0; i < input.photoUris.length; i++) {
    const uri = await resizeAndCompress(input.photoUris[i]);
    form.append(`photo${i}`, { uri, name: `photo${i}.jpg`, type: 'image/jpeg' } as unknown as Blob);
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => ctl.abort());
  try {
    const res = await fetch(`${BASE_URL}/v1/scans`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form, signal: ctl.signal });
    if (res.ok) return (await res.json()) as ScanResult;
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (res.status === 429) throw new ImageScanError('rate_limited');
    if (res.status === 409) throw new ImageScanError('busy');
    if (res.status === 422) throw new ImageScanError('unreadable');
    throw new ImageScanError(body.code === 'bad_request' ? 'failed' : 'failed');
  } catch (e) {
    if (e instanceof ImageScanError) throw e;
    if ((e as { name?: string })?.name === 'AbortError') throw new ImageScanError('timeout');
    throw new ImageScanError('offline');
  } finally {
    clearTimeout(timer);
  }
}

const runner = createScanRunner(post);

/** Checks all photos of a listing together. Identical unchanged requests reuse the previous answer. */
export const scanListingPhotos = (input: ScanInput, signal?: AbortSignal) => runner.scan(input, signal);
export const resetScanCache = () => runner.invalidate();

// ── server-driven rollout policy (migration 0050) ────────────────────────────────────────────────────────────────
const POLICY_TTL_MS = 60_000;

/** The server's current photo-check mode, or null when it can't be read. Cached briefly so a publish never waits on it twice. */
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

/** How this build may publish photos right now: legacy upload, the scan service, or stop with an update-required message. */
export async function decidePublishPath(): Promise<PublishPath> {
  return choosePublishPath(await fetchScanPolicy(), imageScanEnabled);
}
