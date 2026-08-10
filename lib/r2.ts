// Cloudflare R2 is the image storage provider for the app — every image
// upload (listings, avatars, business logos/banners, review/chat images)
// goes through uploadToR2(). The R2 secret access key never reaches this
// client: uploadToR2() asks the r2-presign Edge Function for a short-lived
// presigned PUT URL (scoped to the caller's own folder), uploads directly to
// R2 with it, then Supabase only ever stores the resulting public URL + key.

import { File } from 'expo-file-system';
import { supabase } from '@/lib/supabase';

// lib/imagePipeline.ts's resizeAndCompress() always re-encodes to JPEG
// before this is called, so every object this uploads is JPEG — no need to
// sniff/pass a content type through the presign round trip.
const CONTENT_TYPE = 'image/jpeg';

export type UploadedImage = { url: string; publicId: string };

type PresignResponse = {
  uploads?: { key: string; uploadUrl: string; publicUrl: string }[];
  error?: string;
};

// Uses expo-file-system's new File API (implements Blob) so the PUT body is
// streamed straight from disk on the native side — this deliberately avoids
// React Native's fetch(uri).then(r => r.blob()) pattern, which has a known
// bridge bug that can corrupt binary uploads on some RN/Android versions.
export async function uploadToR2(uri: string, folder: string): Promise<UploadedImage> {
  if (__DEV__) console.log('[R2] Requesting upload URL...');
  const { data, error } = await supabase.functions.invoke<PresignResponse>('r2-presign', {
    body: { folder, count: 1 },
  });
  const upload = data?.uploads?.[0];
  if (error || !upload) {
    const message = data?.error ?? error?.message ?? 'Could not prepare image upload. Check your connection and try again.';
    if (__DEV__) console.error('[R2] Presign failed:', message);
    throw new Error(message);
  }

  if (__DEV__) console.log('[R2] Uploading image...');
  const file = new File(uri);
  const res = await fetch(upload.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': CONTENT_TYPE },
  });
  if (!res.ok) {
    if (__DEV__) console.error('[R2] Upload failed with status', res.status);
    throw new Error('Image upload failed. Check your connection and try again.');
  }
  if (__DEV__) console.log('[R2] Upload complete');
  return { url: upload.publicUrl, publicId: upload.key };
}

// Legacy-compat only: pre-migration rows may still hold an absolute
// Cloudinary secure_url from before this migration. Those keep displaying
// fine with zero ongoing Cloudinary account/credentials — this just
// preserves the delivery transform (auto-format/auto-quality/width-limit)
// that was already baked into how those URLs render. Anything else (R2
// URLs, mock picsum.photos seed images) passes through unchanged: R2 has no
// on-the-fly transform, so current uploads rely on the upload-time
// resize/compress step (lib/imagePipeline.ts) for delivery size instead.
export function imageUrl(url: string, opts?: { width?: number }): string {
  if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  const width = opts?.width ?? 1600;
  const transform = `f_auto,q_auto,c_limit,w_${width}`;
  return url.replace('/upload/', `/upload/${transform}/`);
}

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
