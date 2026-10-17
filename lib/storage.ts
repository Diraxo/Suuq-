import { resizeAndCompress } from '@/lib/imagePipeline';
import { uploadToR2, UploadedImage } from '@/lib/r2';
import { mapWithConcurrency } from '@/lib/concurrency';

export type { UploadedImage };
export type UploadProgress = { completed: number; total: number };

// At most this many resize+upload pipelines run at once — enough to cut
// publish time down from fully-sequential without spiking memory from
// decoding/compressing every photo at the same instant.
const UPLOAD_CONCURRENCY = 4;
// One automatic retry per photo before giving up on it — covers the common
// case of a single flaky request on an otherwise fine connection, without
// restarting the other photos that already uploaded fine.
const RETRIES_PER_IMAGE = 1;

// Photos are compressed in the background as soon as the seller adds them (prewarmCompression, called from the
// Sell photo step), one at a time so the picker never stalls and memory never spikes. Publishing then reuses the
// finished file instead of compressing again. A failed/never-started compression simply falls back to compressing
// at upload time, exactly as before.
const compressed = new Map<string, Promise<string>>();
let compressQueue: Promise<unknown> = Promise.resolve();

export function prewarmCompression(uri: string): void {
  if (compressed.has(uri)) return;
  const job = compressQueue.then(() => resizeAndCompress(uri));
  compressQueue = job.catch(() => {});
  compressed.set(uri, job);
  job.catch(() => compressed.delete(uri));
}

async function compressedUri(uri: string): Promise<string> {
  const cached = compressed.get(uri);
  if (cached) {
    try {
      return await cached;
    } catch {
      compressed.delete(uri);
    }
  }
  return resizeAndCompress(uri);
}

async function uploadOne(userId: string, draftId: string, index: number, total: number, uri: string): Promise<UploadedImage> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES_PER_IMAGE; attempt++) {
    try {
      if (__DEV__) console.log(`[publish] upload image ${index + 1}/${total}${attempt > 0 ? ` (retry ${attempt})` : ''}: resizing/compressing`);
      const localUri = await compressedUri(uri);
      if (__DEV__) console.log(`[publish] upload image ${index + 1}/${total}: uploading to R2`);
      const result = await uploadToR2(localUri, `listings/${userId}/${draftId}`);
      if (__DEV__) console.log(`[publish] upload image ${index + 1}/${total}: done`);
      return result;
    } catch (err: any) {
      lastError = err;
      if (__DEV__) console.warn(`[publish] upload image ${index + 1}/${total} failed${attempt < RETRIES_PER_IMAGE ? ', retrying' : ''}:`, err?.message ?? err);
    }
  }
  throw lastError;
}

export type UploadResult = { images: UploadedImage[]; error: string | null };

// Best-effort upload for first-publish, where a listing with fewer photos than
// picked is still fine — skips any photo that fails (after its retry) rather
// than blocking the whole publish. Reports the last failure reason so the
// caller can surface it instead of a generic "something went wrong" if every
// photo failed. Runs up to UPLOAD_CONCURRENCY resize+upload pipelines at once.
export async function uploadListingImages(userId: string, localUris: string[], onProgress?: (progress: UploadProgress) => void): Promise<UploadResult> {
  const draftId = `${Date.now()}`;
  let completed = 0;
  let lastError: string | null = null;
  const results = await mapWithConcurrency(localUris, UPLOAD_CONCURRENCY, async (uri, i) => {
    try {
      return await uploadOne(userId, draftId, i, localUris.length, uri);
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      if (__DEV__) console.error(`[publish] skipping photo ${i + 1}/${localUris.length} after upload failure:`, lastError);
      return null;
    } finally {
      completed++;
      onProgress?.({ completed, total: localUris.length });
    }
  });
  const uploaded = results.filter((r): r is UploadedImage => !!r);
  if (__DEV__) console.log(`[publish] upload step finished: ${uploaded.length}/${localUris.length} photo(s) uploaded`);
  return { images: uploaded, error: uploaded.length === localUris.length ? null : lastError };
}

// Strict variant for Edit Listing: every photo must upload successfully (after
// its retry), or the whole call rejects so the caller can abort the edit
// rather than save a listing with some images silently missing. Also runs up
// to UPLOAD_CONCURRENCY pipelines at once, and resolves in the same order as
// `localUris` so callers can zip results back to their source uri by index.
export async function uploadListingImagesStrict(userId: string, localUris: string[], onProgress?: (progress: UploadProgress) => void): Promise<UploadedImage[]> {
  const draftId = `${Date.now()}`;
  let completed = 0;
  return mapWithConcurrency(localUris, UPLOAD_CONCURRENCY, async (uri, i) => {
    const result = await uploadOne(userId, draftId, i, localUris.length, uri);
    completed++;
    onProgress?.({ completed, total: localUris.length });
    return result;
  });
}
