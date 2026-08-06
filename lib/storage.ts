import { resizeAndCompress } from '@/lib/imagePipeline';
import { uploadToCloudinary, extractPublicId } from '@/lib/cloudinary';

// Cloudinary public_id extraction for a stored listing-image URL, used to
// clean up removed/replaced photos (see deleteCloudinaryAssets in
// lib/cloudinary.ts). Returns null for anything that isn't a Cloudinary URL
// (e.g. mock catalogue picsum.photos URLs), so callers can safely filter it out.
export const storagePathFromPublicUrl = extractPublicId;

export type UploadedImage = { url: string; publicId: string };

async function uploadOne(userId: string, draftId: string, index: number, total: number, uri: string): Promise<UploadedImage> {
  console.log(`[publish] upload image ${index + 1}/${total}: resizing/compressing`);
  const localUri = await resizeAndCompress(uri);
  console.log(`[publish] upload image ${index + 1}/${total}: uploading to Cloudinary`);
  const result = await uploadToCloudinary(localUri, `suuqplus/listings/${userId}/${draftId}`);
  console.log(`[publish] upload image ${index + 1}/${total}: done`);
  return result;
}

export type UploadResult = { images: UploadedImage[]; error: string | null };

// Best-effort upload for first-publish, where a listing with fewer photos than
// picked is still fine — skips any photo that fails rather than blocking the
// whole publish. Reports the last failure reason so the caller can surface it
// instead of a generic "something went wrong" if every photo failed.
export async function uploadListingImages(userId: string, localUris: string[]): Promise<UploadResult> {
  const draftId = `${Date.now()}`;
  const uploaded: UploadedImage[] = [];
  let lastError: string | null = null;
  for (let i = 0; i < localUris.length; i++) {
    try {
      uploaded.push(await uploadOne(userId, draftId, i, localUris.length, localUris[i]));
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      console.error(`[publish] skipping photo ${i + 1}/${localUris.length} after upload failure:`, lastError);
    }
  }
  console.log(`[publish] upload step finished: ${uploaded.length}/${localUris.length} photo(s) uploaded`);
  return { images: uploaded, error: uploaded.length === localUris.length ? null : lastError };
}

// Strict variant for Edit Listing: every photo must upload successfully, or
// none of them count — the caller can then abort the whole edit rather than
// save a listing with some images silently missing.
export async function uploadListingImagesStrict(userId: string, localUris: string[]): Promise<UploadedImage[]> {
  const draftId = `${Date.now()}`;
  const uploaded: UploadedImage[] = [];
  for (let i = 0; i < localUris.length; i++) {
    uploaded.push(await uploadOne(userId, draftId, i, localUris.length, localUris[i]));
  }
  return uploaded;
}
