import type { ImagePickerAsset } from 'expo-image-picker';
import i18n from '@/lib/i18n';

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
const MAX_BYTES = 10 * 1024 * 1024;
const MIN_DIMENSION = 480;
// Upper bounds guard the on-device decoder (a crafted image can be a few KB on
// disk and gigapixels once decoded). 100 MP is above any phone camera.
const MAX_DIMENSION = 12000;
const MAX_PIXELS = 100_000_000;

export type ImageValidationResult = { ok: true } | { ok: false; message: string };

function extOf(uri: string, mimeType?: string | null): string {
  if (mimeType) {
    const fromMime = mimeType.split('/').pop()?.toLowerCase();
    if (fromMime) return fromMime === 'jpg' ? 'jpeg' : fromMime;
  }
  return uri.split('.').pop()?.split('?')[0]?.toLowerCase() ?? '';
}

export type ImageValidationOptions = {
  /** Profile avatars are cropped to a small square and should never be
   * rejected for dimensions — this check exists to keep listing photos
   * legible, not to gate a personal photo. */
  skipMinDimension?: boolean;
};

// Runs before every upload (listing photos, avatar, business logo/banner,
// review/chat images) via useImageUpload. Never silently rejects — always
// returns the exact user-facing message to show in the black snackbar.
export function validateImageAsset(asset: ImagePickerAsset, options: ImageValidationOptions = {}): ImageValidationResult {
  // Pickers are configured for images only, but a hand-built asset (or a
  // picker quirk) can still carry a video or an arbitrary file — and the
  // extension/MIME here is client metadata, not proof. The real check is that
  // the file decodes: lib/imagePipeline.ts re-encodes every accepted photo
  // through the native image decoder to JPEG, and anything that is not a
  // decodable image fails there and is never uploaded.
  if (asset.type === 'video' || asset.type === 'pairedVideo') {
    return { ok: false, message: i18n.t('errors.unsupportedFileType') };
  }
  if (asset.mimeType && !asset.mimeType.toLowerCase().startsWith('image/')) {
    return { ok: false, message: i18n.t('errors.unsupportedFileType') };
  }
  const ext = extOf(asset.uri, asset.mimeType);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { ok: false, message: i18n.t('errors.unsupportedFileType') };
  }
  if (!options.skipMinDimension) {
    if (asset.width && asset.width < MIN_DIMENSION) {
      return { ok: false, message: i18n.t('errors.imageWidthTooSmall', { size: MIN_DIMENSION }) };
    }
    if (asset.height && asset.height < MIN_DIMENSION) {
      return { ok: false, message: i18n.t('errors.imageHeightTooSmall', { size: MIN_DIMENSION }) };
    }
  }
  if (asset.fileSize === 0) {
    return { ok: false, message: i18n.t('errors.imageEmpty', { defaultValue: 'That file is empty. Choose a different photo.' }) };
  }
  if (
    (asset.width && asset.width > MAX_DIMENSION) ||
    (asset.height && asset.height > MAX_DIMENSION) ||
    (asset.width && asset.height && asset.width * asset.height > MAX_PIXELS)
  ) {
    return { ok: false, message: i18n.t('errors.imageDimensionsTooLarge', { defaultValue: 'That photo is too large. Choose a smaller photo.' }) };
  }
  if (asset.fileSize && asset.fileSize > MAX_BYTES) {
    return { ok: false, message: i18n.t('errors.imageTooLarge', { maxMb: MAX_BYTES / (1024 * 1024) }) };
  }
  return { ok: true };
}
