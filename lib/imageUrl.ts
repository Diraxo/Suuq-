// Delivery sizes for photos. Pure (no React Native / Supabase imports) so it is unit-tested in node (tests/imageUrl.test.ts).
//
// Cloudinary URLs (legacy rows) are resized by a delivery transform in the URL. R2 photos are resized by Cloudflare Image
// Resizing (/cdn-cgi/image/...) ONLY when EXPO_PUBLIC_IMAGE_RESIZE_BASE names the custom domain that serves the bucket and
// that zone has Image Transformations enabled. r2.dev URLs cannot be resized, so with the variable unset (or any other host)
// the original URL is returned unchanged and everything keeps working, just at the uploaded size.

export const IMAGE_WIDTH = {
  /** Blur-up placeholder for photos that have no stored hash. */
  tiny: 32,
  /** Detail-screen thumbnail strip (56pt squares, <=168px on a 3x screen). */
  strip: 200,
  /** Cards, lists, avatars. */
  thumb: 400,
  /** Listing carousel. */
  card: 800,
  /** Full-screen gallery. */
  full: 1600,
} as const;

export type ImageSize = keyof typeof IMAGE_WIDTH;
export type ImageUrlOptions = { width?: number; size?: ImageSize };

const MIN_WIDTH = 16;
const MAX_WIDTH = 2400;

// Session circuit breaker. If resized URLs keep failing while the original loads, the transformation service is misconfigured or down:
// after RESIZE_FAILURE_LIMIT such failures the app stops building resized URLs until it restarts, instead of paying a failed request
// plus a fallback for every photo. The count only grows on proof (the resized URL failed AND its original then loaded).
export const RESIZE_FAILURE_LIMIT = 3;
let resizeFailures = 0;
let resizeTripped = false;

export function reportResizeFailure(): void {
  if (++resizeFailures >= RESIZE_FAILURE_LIMIT) resizeTripped = true;
}
export function reportResizeSuccess(): void {
  if (!resizeTripped) resizeFailures = 0;
}
export function imageResizeTripped(): boolean {
  return resizeTripped;
}
/** Test hook. */
export function resetImageResizeHealth(): void {
  resizeFailures = 0;
  resizeTripped = false;
}

function resizeBase(): string {
  if (resizeTripped) return '';
  const raw = (process.env.EXPO_PUBLIC_IMAGE_RESIZE_BASE ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[A-Za-z0-9.-]+$/.test(raw) ? raw : '';
}

export function imageResizeEnabled(base: string = resizeBase()): boolean {
  return base !== '';
}

export function imageUrl(url: string, opts: ImageUrlOptions = {}, base: string = resizeBase()): string {
  if (!url) return url;
  const requested = opts.size ? IMAGE_WIDTH[opts.size] : opts.width ?? IMAGE_WIDTH.full;
  const width = Math.min(Math.max(Math.round(requested), MIN_WIDTH), MAX_WIDTH);

  if (url.includes('res.cloudinary.com') && url.includes('/upload/')) {
    return url.replace('/upload/', `/upload/f_auto,q_auto,c_limit,w_${width}/`);
  }

  if (base && url.startsWith(`${base}/`)) {
    const path = url.slice(base.length + 1);
    // Already transformed, or not a plain object path: leave it alone rather than build a malformed URL.
    if (path.startsWith('cdn-cgi/') || path.includes('..') || path.includes('?') || path.includes('#')) return url;
    const quality = width <= IMAGE_WIDTH.tiny ? 40 : 75;
    return `${base}/cdn-cgi/image/width=${width},quality=${quality},fit=scale-down,format=auto/${path}`;
  }
  return url;
}

/**
 * The untransformed URL a transformed one was built from, or null when `url` is not a transformed URL. Used as the safe fallback
 * when a resized variant fails to load: the original is always a valid photo address, a rebuilt guess might not be.
 */
export function imageOriginalUrl(url: string): string | null {
  if (!url) return null;
  const cf = /^(https:\/\/[A-Za-z0-9.-]+)\/cdn-cgi\/image\/[^/?#]+\/(.+)$/.exec(url);
  if (cf && !cf[2].includes('..')) return `${cf[1]}/${cf[2]}`;
  if (url.includes('res.cloudinary.com') && /\/upload\/f_auto,q_auto,c_limit,w_\d+\//.test(url)) {
    return url.replace(/\/upload\/f_auto,q_auto,c_limit,w_\d+\//, '/upload/');
  }
  return null;
}

/** Cache identity of a variant: the exact URL requested. Two sizes of one photo are two entries only when resizing really produces two URLs. */
export function imageVariantKey(url: string, opts: ImageUrlOptions = {}, base?: string): string {
  return imageUrl(url, opts, base);
}
