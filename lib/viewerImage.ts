// Load-state rules for the full-screen photo viewer (components/ZoomableImage.tsx, app/listing/gallery/[id].tsx).
// Pure so they can be tested without React Native. Every exit path from 'loading' is explicit: a photo either loads,
// fails, or times out, so the spinner can never outlive the request.

export type ViewerImageStatus = 'loading' | 'loaded' | 'error';
export type ViewerImageEvent = 'start' | 'load' | 'error' | 'timeout';

/** A photo that has neither loaded nor failed after this long is shown as failed (with a retry) instead of spinning forever. */
export const VIEWER_IMAGE_TIMEOUT_MS = 20000;

/**
 * Which photos of the full-screen viewer are fully built. The list keeps one cell per photo mounted for the whole visit, so a
 * swipe never mounts or unmounts a cell (building a photo view with its gestures and watermark mid-swipe froze the scroll for
 * seconds). What changes is only how much each cell holds: the open photo is built at once, its neighbours one beat later
 * (`warm`), and every other cell stays an empty shell. `active` changes only when a swipe has settled, so the cost of building
 * the next neighbours lands while the viewer is at rest, never inside the swipe.
 */
export const VIEWER_BUILD_RADIUS = 2;
export function viewerCellBuilt(index: number, active: number, warm: boolean): boolean {
  return index === active || (warm && Math.abs(index - active) <= VIEWER_BUILD_RADIUS);
}

/** The viewer's list window: wide enough that every cell (at most MAX_PHOTOS) stays mounted, so scrolling never mounts one. Only the
 *  cells viewerCellBuilt() selects hold a full-screen image with gestures and a watermark layer; the rest are empty shells. */
export const VIEWER_WINDOW = { windowSize: 21 } as const;

export function nextViewerImageStatus(status: ViewerImageStatus, event: ViewerImageEvent): ViewerImageStatus {
  switch (event) {
    case 'start':
      return 'loading';
    case 'load':
      return 'loaded';
    case 'error':
      return 'error';
    case 'timeout':
      // A late timer must never turn an already-shown photo into an error.
      return status === 'loading' ? 'error' : status;
  }
}

/** What the viewer shows around the photos. The close button is part of every state: it never depends on the listing or a photo. */
export function viewerState(listingStatus: 'loading' | 'ready' | 'missing' | 'error'): 'photos' | 'loading' | 'failed' {
  if (listingStatus === 'ready') return 'photos';
  if (listingStatus === 'loading') return 'loading';
  return 'failed';
}

/** What the viewer draws for one photo. The watermark rule is the point: a real photo is only ever visible together with the
 *  mark it needs. `photo` is the layer holding the picture (opacity 1) and `watermark` the client-side overlay; for a photo
 *  that needs the overlay, `photo` can be true only when `watermark` is too (the overlay needs the photo's pixel size, which is
 *  either remembered from an earlier load of the same photo or comes from this photo's own load event). The `backdrop` is the
 *  blurred placeholder (a thumbhash or a ~32px stand-in, not a usable copy of the photo): it stays under the photo until the
 *  photo has been handed to the native view AND a frame has passed (`displayed`), so there is never a gap where the stand-in
 *  is gone and the photo is not yet on screen. */
export function viewerLayers(input: {
  status: ViewerImageStatus;
  /** The photo's pixel size, once known (a load event, or remembered from the listing page). */
  hasSize: boolean;
  /** The URL is a Worker-published derivative with the mark already baked in. */
  bakedWatermark: boolean;
  hasPlaceholder: boolean;
  /** The full photo was displayed by the native view and a frame has been committed since. */
  displayed?: boolean;
  /** A real photo layer (the card preview or the full photo) has loaded. The mark is revealed only with it, never before, so the
   *  viewer never shows the mark over a blur or a black screen while the picture is still on its way. */
  painted: boolean;
}): { photo: boolean; watermark: boolean; backdrop: boolean } {
  const watermark = !input.bakedWatermark && input.hasSize && input.painted;
  const photo = input.bakedWatermark || watermark;
  const backdrop = input.hasPlaceholder && !input.displayed && input.status !== 'error';
  return { photo, watermark, backdrop };
}

/** The spinner only appears for a photo that is still not visible after this long: a cached photo never flashes one. */
export const VIEWER_SPINNER_DELAY_MS = 250;

// ── Remembered photo sizes ──────────────────────────────────────────────────────────────────────────────────────────
// The overlay needs the photo's pixel size. The listing page has already loaded the same photo (at card size), and the mark's
// layout is scale-invariant (font and spacing are proportional to the short side), so that size is as good as the viewer's own
// load event and lets the mark be drawn in the viewer's first frame instead of after a load round trip.

const SIZE_MEMORY_LIMIT = 200;
const sizes = new Map<string, { w: number; h: number }>();

export function rememberImageSize(uri: string, w: unknown, h: unknown): void {
  if (!uri || typeof w !== 'number' || typeof h !== 'number' || !(w > 0 && h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return;
  sizes.delete(uri);
  sizes.set(uri, { w, h });
  if (sizes.size > SIZE_MEMORY_LIMIT) sizes.delete(sizes.keys().next().value as string);
}

export function knownImageSize(uri: string): { w: number; h: number } | null {
  return sizes.get(uri) ?? null;
}

// ── Gallery preparation order ───────────────────────────────────────────────────────────────────────────────────────

/** Indexes in the order the viewer is likely to need them: the open photo, then the next, then the previous, then outward. */
export function galleryPrefetchOrder(count: number, active: number): number[] {
  if (!(count > 0)) return [];
  const start = Math.max(0, Math.min(Math.trunc(active) || 0, count - 1));
  const order = [start];
  for (let d = 1; order.length < count; d++) {
    if (start + d < count) order.push(start + d);
    if (start - d >= 0) order.push(start - d);
  }
  return order;
}

// ── Diagnostics ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A photo address safe to log: host and file name only. Signed-URL query strings, credentials and fragments are dropped. */
export function redactImageUrl(url: string): string {
  try {
    const u = new URL(url);
    const file = u.pathname.split('/').filter(Boolean).pop() ?? '';
    return `${u.host}/…/${file.slice(0, 24)}`;
  } catch {
    return '(unparsable)';
  }
}
