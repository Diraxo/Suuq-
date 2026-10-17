// Browser equivalent of lib/r2.ts on mobile: same r2-presign Edge Function
// (short-lived presigned PUT URL scoped to the caller's own folder), same
// "client never holds an R2 credential" model — just a plain fetch() PUT
// instead of expo-file-system's uploadAsync, since a browser File object is
// already a real Blob.
import { supabase } from '@/lib/supabase';
import { prepareImage, isPreparedImage } from '@/services/imagePrep';

export type UploadedImage = { url: string; key: string };

type PresignResponse = {
  uploads?: { key: string; uploadUrl: string; publicUrl: string }[];
  error?: string;
};


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
  return data?.error ?? error?.message ?? 'Could not prepare image upload.';
}

export async function uploadToR2(file: Blob, folder: string): Promise<UploadedImage> {
  // Every upload goes through the same intake (byte-level format check +
  // decode + JPEG re-encode) — a caller that already ran prepareImage() (the
  // Sell/Edit photo pickers do, to show errors immediately) isn't charged twice.
  const body = isPreparedImage(file) ? file : await prepareImage(file, { skipMinDimension: true });
  const { data, error } = await supabase.functions.invoke<PresignResponse>('r2-presign', {
    body: { folder, count: 1 },
  });
  const upload = data?.uploads?.[0];
  if (error || !upload) {
    throw new Error(await presignFailureMessage(data ?? null, error));
  }

  const res = await fetch(upload.uploadUrl, {
    method: 'PUT',
    // Always JPEG — r2-presign signs this exact content type into the URL.
    headers: { 'Content-Type': 'image/jpeg' },
    body,
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

// Legacy fallback only. Web listings now persist the upload key in
// image_public_ids (like mobile); rows created before that have no stored key,
// so it is derived back out of the public URL's path. Skips non-R2 URLs (legacy
// Cloudinary rows, picsum placeholders). Prefer imageKeyFor() below.
export function r2KeyFromUrl(url: string): string | null {
  if (!url || url.includes('cloudinary.com') || url.includes('picsum.photos')) return null;
  try {
    const key = new URL(url).pathname.replace(/^\//, '');
    return key || null;
  } catch {
    return null;
  }
}

// Stored key (image_public_ids, same index as images) when present, else the
// legacy URL-derived one.
export function imageKeyFor(listing: { images: string[]; imagePublicIds?: string[] }, url: string): string | null {
  const i = listing.images.indexOf(url);
  const stored = i >= 0 ? listing.imagePublicIds?.[i] : undefined;
  // Trust a stored key only if it is actually the tail of this URL's path (guards against index drift).
  if (stored && url.endsWith('/' + stored)) return stored;
  return r2KeyFromUrl(url);
}
