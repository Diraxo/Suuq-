import type { ImagePickerAsset } from 'expo-image-picker';
import i18n from '@/lib/i18n';

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

// NOTE: the sole consumer (app/post/index.tsx, outside this batch) splits this
// on the blank line to get an Alert title/message pair — the translated value
// must keep that two-paragraph "title\n\nbody" shape. Also note this is a
// module-level constant evaluated once at import time, so it won't reflect a
// language change that happens after this module first loads without an app
// reload/re-import; a live-updating version would need the call site changed
// to call i18n.t() itself, which is out of scope for this batch.
export const SCREENSHOT_WARNING = i18n.t('imageModeration.screenshotWarning');
