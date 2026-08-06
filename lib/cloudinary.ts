// Cloudinary is the only image provider in the app — every image upload
// (listings, avatars, business logos/banners, review/chat images) goes
// through uploadToCloudinary(). Supabase only ever stores the resulting URL.

import { supabase } from '@/lib/supabase';

const CLOUD_NAME = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME as string;
const UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET as string;

if (!CLOUD_NAME || !UPLOAD_PRESET) {
  throw new Error('Missing EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME / EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET env vars.');
}

const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

export type CloudinaryUploadResult = { url: string; publicId: string };

// Uses React Native's native FormData file handling — passing an object with
// a `uri` field streams the file straight off disk on the native side. This
// is the standard RN multipart-upload pattern and is unrelated to (and does
// not hit) the fetch().blob() bridge-corruption bug that lib/storage.ts's
// JSDoc warns about for Supabase Storage's upload() call.
export async function uploadToCloudinary(uri: string, folder: string): Promise<CloudinaryUploadResult> {
  const ext = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
  const form = new FormData();
  form.append('file', {
    uri,
    name: `upload.${ext}`,
    type: EXT_TO_MIME[ext] || 'image/jpeg',
  } as unknown as Blob);
  form.append('upload_preset', UPLOAD_PRESET);
  form.append('folder', folder);

  console.log('[Cloudinary] Uploading image...');
  const res = await fetch(UPLOAD_URL, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok || data.error) {
    const message = data.error?.message ?? 'Image upload failed. Check your connection and try again.';
    console.error('[Cloudinary] Upload failed:', message);
    throw new Error(message);
  }
  console.log('[Cloudinary] Upload complete');
  return { url: data.secure_url as string, publicId: data.public_id as string };
}

// Inserts a delivery transformation into a stored Cloudinary secure_url so
// every render gets auto-format (WebP where supported) and auto-quality
// (~80% JPEG-equivalent) without needing preset-level dashboard config.
// Callers always store the plain secure_url from uploadToCloudinary() and
// only call cldUrl() at render time, so extractPublicId() below stays valid.
export function cldUrl(url: string, opts?: { width?: number }): string {
  if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  const width = opts?.width ?? 1600;
  const transform = `f_auto,q_auto,c_limit,w_${width}`;
  return url.replace('/upload/', `/upload/${transform}/`);
}

// Reverse of uploadToCloudinary's public_id, for cleanup calls (deleting a
// removed/replaced photo). Mirrors storagePathFromPublicUrl's role for the
// old Supabase Storage bucket. Returns null for non-Cloudinary URLs (e.g.
// stale mock picsum.photos seed images) so callers can filter them out.
export function extractPublicId(url: string): string | null {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:\?.*)?$/);
  return match ? match[1] : null;
}

export type CloudinaryDeleteResult = { succeeded: string[]; failed: string[] };

// Deletes previously-uploaded Cloudinary assets via the cloudinary-delete
// Edge Function — the API secret needed to authorize a delete never leaves
// the server, so this can't be done directly from the client. Best-effort
// and never throws: a failed cleanup call never blocks the caller's own
// save/delete flow, but the returned succeeded/failed lists let callers that
// care (e.g. listing delete) report which image failed.
export async function deleteCloudinaryAssets(publicIds: string[]): Promise<CloudinaryDeleteResult> {
  const unique = [...new Set(publicIds.filter(Boolean))];
  if (unique.length === 0) return { succeeded: [], failed: [] };

  console.log('[Cloudinary] Deleting previous image...');
  try {
    const { data, error } = await supabase.functions.invoke('cloudinary-delete', { body: { publicIds: unique } });
    if (error) {
      console.error('[Cloudinary] Delete failed:', error.message);
      return { succeeded: [], failed: unique };
    }
    const succeeded: string[] = data?.succeeded ?? [];
    const failed: string[] = data?.failed ?? [];
    const deleted: Record<string, string> = data?.deleted ?? {};
    if (__DEV__) {
      for (const id of succeeded) {
        console.log(deleted[id] === 'not_found' ? '[Cloudinary] Delete skipped (already deleted)' : '[Cloudinary] Delete successful', id);
      }
      for (const id of failed) console.warn('[Cloudinary] Delete failed:', id);
    }
    return { succeeded, failed };
  } catch (err: any) {
    console.error('[Cloudinary] Delete failed:', err?.message ?? String(err));
    return { succeeded: [], failed: unique };
  }
}
