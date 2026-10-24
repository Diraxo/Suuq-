// Load-state rules for the full-screen photo viewer (components/ZoomableImage.tsx, app/listing/gallery/[id].tsx).
// Pure so they can be tested without React Native. Every exit path from 'loading' is explicit: a photo either loads,
// fails, or times out, so the spinner can never outlive the request.

export type ViewerImageStatus = 'loading' | 'loaded' | 'error';
export type ViewerImageEvent = 'start' | 'load' | 'error' | 'timeout';

/** A photo that has neither loaded nor failed after this long is shown as failed (with a retry) instead of spinning forever. */
export const VIEWER_IMAGE_TIMEOUT_MS = 20000;

/** How many photos the viewer keeps mounted: each is a full-screen image with gestures and a watermark layer. */
export const VIEWER_WINDOW = { initialNumToRender: 1, maxToRenderPerBatch: 1, windowSize: 3 } as const;

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
