// Format / structure check for image bytes — pure TypeScript (no Deno, DOM or
// node APIs), so the same code runs in the Edge Functions, the website and the
// node test suite (tests/imageBytes.test.ts).
//
// web/src/lib/imageBytes.ts is a verbatim copy (the web build can't import
// from outside web/); a parity test fails if they drift apart.
//
// What this is and is not: it identifies the *actual* container format from
// the bytes (never the file name, extension or declared MIME type), reads the
// declared pixel dimensions, and detects truncation — enough to reject text,
// JSON, PDF, SVG, scripts, video, archives, empty and cut-off files. It does
// NOT decode pixels, so it is an allowlist gate in FRONT of a real decoder,
// never a replacement for one: the website decodes + re-encodes every file to
// JPEG in the browser, the mobile app re-encodes with the native
// ImageManipulator, and the r2-verify-images Edge Function applies this check
// (JPEG only) to whatever actually landed in storage.

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'heic';

export type ImageInfo = { format: ImageFormat; width?: number; height?: number };

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 12000;
export const MAX_IMAGE_PIXELS = 100_000_000;

export type ImageRejectReason = 'empty' | 'too-large' | 'not-an-image' | 'format-not-allowed' | 'truncated' | 'bad-dimensions' | 'too-many-pixels';

export type ImageCheck = { ok: true; info: ImageInfo } | { ok: false; reason: ImageRejectReason };

const ascii = (b: Uint8Array, start: number, len: number) => {
  let s = '';
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u32le = (b: Uint8Array, i: number) => ((b[i + 3] << 24) | (b[i + 2] << 16) | (b[i + 1] << 8) | b[i]) >>> 0;

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif'];

type Found = { info: ImageInfo; complete: boolean };

function jpegInfo(b: Uint8Array): Found | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  let width: number | undefined;
  let height: number | undefined;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null; // marker expected — not a well-formed JPEG
    while (b[i] === 0xff && i + 1 < b.length) i++; // fill bytes
    const marker = b[i];
    i++;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no payload
    if (marker === 0xd9) break;
    if (i + 1 >= b.length) break;
    const len = u16be(b, i);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 6 >= b.length) break;
      height = u16be(b, i + 3);
      width = u16be(b, i + 5);
      break;
    }
    if (marker === 0xda) break; // start of scan before any frame header → malformed
    i += len;
  }
  if (width === undefined || height === undefined) return null;
  // An intact JPEG ends with the EOI marker (trailing zero padding tolerated).
  let end = b.length;
  while (end > 2 && b[end - 1] === 0) end--;
  const complete = end >= 2 && b[end - 2] === 0xff && b[end - 1] === 0xd9;
  return { info: { format: 'jpeg', width, height }, complete };
}

function pngInfo(b: Uint8Array): Found | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || sig.some((v, i) => b[i] !== v)) return null;
  if (u32be(b, 8) !== 13 || ascii(b, 12, 4) !== 'IHDR') return null;
  const complete = b.length >= 45 && ascii(b, b.length - 8, 4) === 'IEND';
  return { info: { format: 'png', width: u32be(b, 16), height: u32be(b, 20) }, complete };
}

function webpInfo(b: Uint8Array): Found | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const complete = u32le(b, 4) + 8 <= b.length;
  const chunk = ascii(b, 12, 4);
  let width: number | undefined;
  let height: number | undefined;
  if (chunk === 'VP8X') {
    width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
  } else if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    width = 1 + (bits & 0x3fff);
    height = 1 + ((bits >>> 14) & 0x3fff);
  } else if (chunk === 'VP8 ') {
    if (!(b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)) return null;
    width = (b[26] | (b[27] << 8)) & 0x3fff;
    height = (b[28] | (b[29] << 8)) & 0x3fff;
  } else {
    return null;
  }
  return { info: { format: 'webp', width, height }, complete };
}

function heicInfo(b: Uint8Array): Found | null {
  if (b.length < 16 || ascii(b, 4, 4) !== 'ftyp') return null;
  if (!HEIC_BRANDS.includes(ascii(b, 8, 4))) return null;
  return { info: { format: 'heic' }, complete: true };
}

const identify = (b: Uint8Array): Found | null => jpegInfo(b) ?? pngInfo(b) ?? webpInfo(b) ?? heicInfo(b);

/** Identifies the image container from its bytes. Returns null for anything that is not a (structurally plausible) JPEG/PNG/WebP/HEIC. */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  return identify(bytes)?.info ?? null;
}

/**
 * Full allowlist check on the complete file bytes: non-empty, within the size
 * cap, a real image container of an allowed format, plausible dimensions and
 * not truncated.
 */
export function checkImageBytes(bytes: Uint8Array, opts: { allowed?: readonly ImageFormat[]; maxBytes?: number } = {}): ImageCheck {
  const allowed = opts.allowed ?? ['jpeg', 'png', 'webp', 'heic'];
  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  if (bytes.length > maxBytes) return { ok: false, reason: 'too-large' };

  const found = identify(bytes);
  if (!found) return { ok: false, reason: 'not-an-image' };
  if (!allowed.includes(found.info.format)) return { ok: false, reason: 'format-not-allowed' };
  if (!found.complete) return { ok: false, reason: 'truncated' };

  const { width, height } = found.info;
  if (width !== undefined && height !== undefined) {
    if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) return { ok: false, reason: 'bad-dimensions' };
    if (width * height > MAX_IMAGE_PIXELS) return { ok: false, reason: 'too-many-pixels' };
  }
  return { ok: true, info: found.info };
}

/** Human-readable explanation for a rejection, safe to show to users. */
export function describeImageRejection(reason: ImageRejectReason): string {
  switch (reason) {
    case 'empty':
      return 'That file is empty.';
    case 'too-large':
      return `That file is too large (maximum ${MAX_IMAGE_BYTES / (1024 * 1024)} MB).`;
    case 'format-not-allowed':
      return 'This image format is not supported. Use JPG, PNG, WEBP or HEIC.';
    case 'truncated':
      return 'That image looks damaged or incomplete. Try a different photo.';
    case 'bad-dimensions':
    case 'too-many-pixels':
      return 'That photo is too large in pixels. Choose a smaller photo.';
    default:
      return "That file isn't a photo. Use JPG, PNG, WEBP or HEIC.";
  }
}
