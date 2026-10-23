// Cloudflare R2 is the image storage provider for the app — every image
// upload (listings, avatars, business logos/banners, review images)
// goes through uploadToR2(). The R2 secret access key never reaches this
// client: uploadToR2() asks the r2-presign Edge Function for a short-lived
// presigned PUT URL (scoped to the caller's own folder), uploads directly to
// R2 with it, then Supabase only ever stores the resulting public URL + key.

import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import i18n from '@/lib/i18n';
import { translateText } from '@/lib/textKeys';


// lib/imagePipeline.ts's resizeAndCompress() always re-encodes to JPEG
// before this is called, so every object this uploads is JPEG — no need to
// sniff/pass a content type through the presign round trip.
const CONTENT_TYPE = 'image/jpeg';

// The ETag S3-compatible storage (including R2) always returns for a PUT of
// a zero-byte object — the MD5 of an empty string. uploadAsync's BINARY_CONTENT
// mode has a known Android issue (expo-file-system + expo-image-manipulator)
// where the request occasionally goes out with an empty body despite reading
// a valid, non-empty local file: R2 still returns 200 for that PUT, so status
// alone can't tell a real upload from a silently-empty one. Comparing the
// ETag against this constant is what actually catches it.
const EMPTY_BODY_ETAG = '"d41d8cd98f00b204e9800998ecf8427e"';

export type UploadedImage = { url: string; publicId: string };

type PresignResponse = {
  uploads?: { key: string; uploadUrl: string; publicUrl: string }[];
  error?: string;
};

// Uses the legacy expo-file-system's uploadAsync(), which reads the file and
// performs the HTTP PUT entirely on the native side. This deliberately
// avoids two known-broken alternatives in React Native: (1) fetch(uri).then(r
// => r.blob()) to read a local file, which has a known bridge bug that can
// corrupt binary reads on some RN/Android versions, and (2) passing the new
// expo-file-system File object (which merely implements the Blob *interface*,
// not RN's actual Blob class) directly as a fetch() body — RN's fetch only
// knows how to serialize its own Blob/FormData/string/ArrayBuffer bodies, so
// a third-party Blob-alike silently serializes to an empty body: the PUT
// still returns 200, but R2 stores a real, publicly-fetchable 0-byte object
// (verified in production: HTTP 200, Content-Type: image/jpeg, Content-Length:
// 0), which every image consumer then renders as a blank/black box.

// supabase-js hides a non-2xx Edge Function body inside error.context (a Response). r2-presign answers refusals with
// { error, code } — e.g. 426 "update required" once listing photos must go through the scan service — so surface its
// own message instead of "Edge Function returned a non-2xx status code".
async function presignFailureMessage(data: PresignResponse | null, error: { message?: string; context?: unknown } | null): Promise<string> {
  const ctx = error?.context as { clone?: () => { json: () => Promise<unknown> } } | undefined;
  if (ctx && typeof ctx.clone === 'function') {
    try {
      const body = (await ctx.clone().json()) as { error?: unknown };
      if (typeof body?.error === 'string' && body.error) return body.error;
    } catch {
      /* not JSON — fall through */
    }
  }
  return data?.error ?? error?.message ?? translateText((k, o) => String(i18n.t(k, o as never)), 'Could not prepare image upload. Check your connection and try again.');
}

export async function uploadToR2(uri: string, folder: string): Promise<UploadedImage> {
  // Profile photos, logos and banners are NOT scanned (owner decision 2026-10-21): same presigned path as every other image.
  if (__DEV__) console.log('[R2] Requesting upload URL...');
  const { data, error } = await supabase.functions.invoke<PresignResponse>('r2-presign', {
    body: { folder, count: 1 },
  });
  const upload = data?.uploads?.[0];
  if (error || !upload) {
    const message = await presignFailureMessage(data ?? null, error);
    if (__DEV__) console.error('[R2] Presign failed:', message);
    throw new Error(message);
  }

  if (__DEV__) console.log('[R2] Uploading image...');
  const res = await uploadAsync(upload.uploadUrl, uri, {
    httpMethod: 'PUT',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': CONTENT_TYPE },
  });
  if (res.status < 200 || res.status >= 300) {
    if (__DEV__) console.error('[R2] Upload failed with status', res.status, res.body?.slice(0, 300));
    throw new Error('Image upload failed. Check your connection and try again.');
  }
  const etag = res.headers?.ETag ?? res.headers?.etag;
  if (etag === EMPTY_BODY_ETAG) {
    if (__DEV__) console.error('[R2] Upload silently sent an empty body (status 200, empty-body ETag)');
    throw new Error('Image upload failed. Check your connection and try again.');
  }
  if (__DEV__) console.log('[R2] Upload complete');
  return { url: upload.publicUrl, publicId: upload.key };
}

// Delivery sizing (Cloudinary legacy rows, and R2 photos when Cloudflare Image Resizing is configured) lives in lib/imageUrl.ts
// so it can be unit-tested without React Native; re-exported here because every screen imports it from this module.
export { imageUrl, IMAGE_WIDTH } from '@/lib/imageUrl';
export type { ImageSize } from '@/lib/imageUrl';

export type R2DeleteResult = { succeeded: string[]; failed: string[] };

// Deletes previously-uploaded R2 objects via the r2-delete Edge Function —
// the R2 secret needed to authorize a delete never leaves the server, so
// this can't be done directly from the client. Best-effort and never
// throws: a failed cleanup call never blocks the caller's own save/delete
// flow, but the returned succeeded/failed lists let callers that care (e.g.
// listing delete) report which image failed. Only ever called with R2 keys
// (stored alongside the URL at upload time) — pre-migration rows that only
// have a Cloudinary URL and no stored key are simply left alone, since
// there's no Cloudinary credential left to delete them with.
export async function deleteR2Assets(keys: string[]): Promise<R2DeleteResult> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return { succeeded: [], failed: [] };

  if (__DEV__) console.log('[R2] Deleting previous image(s)...');
  try {
    const { data, error } = await supabase.functions.invoke('r2-delete', { body: { keys: unique } });
    if (error) {
      if (__DEV__) console.error('[R2] Delete failed:', error.message);
      return { succeeded: [], failed: unique };
    }
    const succeeded: string[] = data?.succeeded ?? [];
    const failed: string[] = data?.failed ?? [];
    if (__DEV__) {
      for (const key of succeeded) console.log('[R2] Delete successful', key);
      for (const key of failed) console.warn('[R2] Delete failed:', key);
    }
    return { succeeded, failed };
  } catch (err: any) {
    if (__DEV__) console.error('[R2] Delete failed:', err?.message ?? String(err));
    return { succeeded: [], failed: unique };
  }
}
