import type { ImagePickerAsset } from 'expo-image-picker';
import i18n from '@/lib/i18n';

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
const MAX_BYTES = 10 * 1024 * 1024;
const MIN_DIMENSION = 480;

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
  if (asset.fileSize && asset.fileSize > MAX_BYTES) {
    return { ok: false, message: i18n.t('errors.imageTooLarge', { maxMb: MAX_BYTES / (1024 * 1024) }) };
  }
  return { ok: true };
}
