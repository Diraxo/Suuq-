import type { ImagePickerAsset } from 'expo-image-picker';

export type ModerationResult = { suspicious: boolean; reason?: 'filename' | 'metadata' };

// Common phone/tablet screen aspect ratios (short side / long side) —
// screenshots are captured at exactly the device's screen resolution, so
// they cluster tightly around these ratios, unlike photos taken with a
// camera (which vary continuously with framing/crop).
const SCREEN_ASPECT_RATIOS = [9 / 16, 9 / 18, 9 / 19.5, 9 / 20, 3 / 4, 2 / 3];
const ASPECT_TOLERANCE = 0.015;

// Heuristic-only screenshot / low-quality-image detector — no ML/vision
// model, just filename + format + EXIF + aspect-ratio signals available
// locally from the picker. Deliberately can't detect an actual marketplace
// watermark or logo baked into the pixels (that needs real image content
// analysis); it only catches the "this is obviously a screenshot, not an
// original photo" case, which is the common version of the same problem.
// Kept as a single swappable entry point so a real vision API can replace
// (or augment) the body later without touching any call site.
export function checkImage(asset: ImagePickerAsset): ModerationResult {
  const filename = (asset.fileName ?? asset.uri ?? '').toLowerCase();
  if (filename.includes('screenshot') || filename.includes('screen shot') || filename.includes('screen-shot')) {
    return { suspicious: true, reason: 'filename' };
  }

  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  if (width > 0 && height > 0) {
    const ratio = Math.min(width, height) / Math.max(width, height);
    const matchesScreenRatio = SCREEN_ASPECT_RATIOS.some((r) => Math.abs(r - ratio) < ASPECT_TOLERANCE);
    const isPng = asset.mimeType?.toLowerCase() === 'image/png';
    const exif = asset.exif as Record<string, unknown> | null | undefined;
    const hasCameraExif = !!exif && (!!exif.Make || !!exif.DateTimeOriginal || !!exif.LensModel);
    if (matchesScreenRatio && isPng && !hasCameraExif) {
      return { suspicious: true, reason: 'metadata' };
    }
  }

  return { suspicious: false };
}

export const SCREENSHOT_WARNING =
  "This image appears to be a screenshot or contains another marketplace's branding.\n\nPlease upload the original photo to improve the quality of your listing.";
