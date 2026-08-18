// Browser equivalent of lib/r2.ts on mobile: same r2-presign Edge Function
// (short-lived presigned PUT URL scoped to the caller's own folder), same
// "client never holds an R2 credential" model — just a plain fetch() PUT
// instead of expo-file-system's uploadAsync, since a browser File object is
// already a real Blob.
import { supabase } from '@/lib/supabase';

export type UploadedImage = { url: string; key: string };

type PresignResponse = {
  uploads?: { key: string; uploadUrl: string; publicUrl: string }[];
  error?: string;
};

export async function uploadToR2(file: File, folder: string): Promise<UploadedImage> {
  const { data, error } = await supabase.functions.invoke<PresignResponse>('r2-presign', {
    body: { folder, count: 1 },
  });
  const upload = data?.uploads?.[0];
  if (error || !upload) {
    throw new Error(data?.error ?? error?.message ?? 'Could not prepare image upload.');
  }

  const res = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'image/jpeg' },
    body: file,
  });
  if (!res.ok) throw new Error('Image upload failed. Check your connection and try again.');

  return { url: upload.publicUrl, key: upload.key };
}

export type R2DeleteResult = { succeeded: string[]; failed: string[] };

// Mirrors deleteR2Assets() in lib/r2.ts on mobile — same r2-delete Edge
// Function, best-effort (never throws, never blocks the caller's own
// delete/save flow on a cleanup failure).
export async function deleteFromR2(keys: string[]): Promise<R2DeleteResult> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return { succeeded: [], failed: [] };
  try {
    const { data, error } = await supabase.functions.invoke<R2DeleteResult>('r2-delete', { body: { keys: unique } });
    if (error) return { succeeded: [], failed: unique };
    return { succeeded: data?.succeeded ?? [], failed: data?.failed ?? [] };
  } catch {
    return { succeeded: [], failed: unique };
  }
}

// The web `listings` insert (services/listings.ts's createListing) doesn't
// persist the R2 object key returned at upload time — unlike mobile, which
// stores it in `image_public_ids` — so on delete/edit the key is derived
// back out of the public URL's path instead. Skips non-R2 URLs (legacy
// Cloudinary rows, picsum placeholders) the same way mobile skips rows with
// no stored public id: there's no way to delete those from here.
export function r2KeyFromUrl(url: string): string | null {
  if (!url || url.includes('cloudinary.com') || url.includes('picsum.photos')) return null;
  try {
    const key = new URL(url).pathname.replace(/^\//, '');
    return key || null;
  } catch {
    return null;
  }
}
