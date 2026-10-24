// The full-screen photo viewer must never trap the person: the close button exists in every state, and a photo that stalls,
// fails or is swapped mid-load always leaves the loading state. Reported on TestFlight: black viewer, permanent spinner,
// scrolling and X unresponsive on a five-photo listing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nextViewerImageStatus, viewerState, VIEWER_IMAGE_TIMEOUT_MS, VIEWER_WINDOW } from '../lib/viewerImage';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('every exit from loading is explicit: load, error and timeout all clear the spinner', () => {
  assert.equal(nextViewerImageStatus('loading', 'load'), 'loaded');
  assert.equal(nextViewerImageStatus('loading', 'error'), 'error');
  assert.equal(nextViewerImageStatus('loading', 'timeout'), 'error');
});

test('a late timeout never turns a shown photo into an error, and retry/swap restarts loading', () => {
  assert.equal(nextViewerImageStatus('loaded', 'timeout'), 'loaded');
  assert.equal(nextViewerImageStatus('error', 'timeout'), 'error');
  assert.equal(nextViewerImageStatus('error', 'start'), 'loading');
  assert.equal(nextViewerImageStatus('loaded', 'start'), 'loading');
});

test('rapid swaps: whatever order load/error/timeout arrive in, the status is never stuck at loading', () => {
  const events = ['start', 'load', 'error', 'timeout'] as const;
  for (const a of events) for (const b of events) for (const c of events) {
    let s = nextViewerImageStatus('loading', 'start');
    for (const e of [a, b, c]) s = nextViewerImageStatus(s, e);
    s = nextViewerImageStatus(s, 'timeout');
    if (c !== 'start' && ![a, b, c].includes('start')) assert.notEqual(s, 'loading', `${a},${b},${c}`);
  }
  assert.ok(VIEWER_IMAGE_TIMEOUT_MS >= 5000 && VIEWER_IMAGE_TIMEOUT_MS <= 60000);
});

test('listing states: photos only when ready; loading and failed are screens of their own, not a blank view', () => {
  assert.equal(viewerState('ready'), 'photos');
  assert.equal(viewerState('loading'), 'loading');
  assert.equal(viewerState('error'), 'failed');
  assert.equal(viewerState('missing'), 'failed');
});

test('the viewer keeps only a few photos mounted', () => {
  assert.ok(VIEWER_WINDOW.windowSize <= 5 && VIEWER_WINDOW.initialNumToRender <= 2 && VIEWER_WINDOW.maxToRenderPerBatch <= 2);
});

test('gallery route: no early return before the close button, windowed list, bounded prefetch', () => {
  const src = read('app/listing/gallery/[id].tsx');
  assert.ok(!/if \(!listing\) return null/.test(src), 'must not render nothing (no X) while the listing is loading or failed');
  assert.match(src, /listing\.gallery\.close/);
  assert.ok(src.indexOf("router.back()}") !== -1);
  assert.match(src, /windowSize=\{VIEWER_WINDOW\.windowSize\}/);
  assert.ok(!/Image\.prefetch\(images\.map/.test(src), 'must not prefetch every photo at once');
  assert.ok(!/initialScrollIndex=\{Math\.min\(active, listing\.images\.length - 1\)\}/.test(src), 'empty image list must not give a negative index');
});

test('ZoomableImage: timeout, retry, and the error state is not a dead end', () => {
  const src = read('components/ZoomableImage.tsx');
  assert.match(src, /VIEWER_IMAGE_TIMEOUT_MS/);
  assert.match(src, /'timeout'/);
  assert.match(src, /setAttempt/);
  assert.ok(!/setStatus\('(loaded|error|loading)'\)/.test(src), 'status changes go through nextViewerImageStatus');
  // The spinner never intercepts touches.
  assert.match(src, /status === 'loading' && !previewReady && \(\s*<View style=\{\{ position: 'absolute' \}\} pointerEvents="none">/);
});

test('viewer opens with the cached card-size photo under the full one, and logs tap timings', () => {
  const z = read('components/ZoomableImage.tsx');
  assert.match(z, /imageUrl\(uri, \{ size: 'card' \}\)/);
  assert.match(z, /viewer: tap to preview/);
  assert.match(z, /viewer: tap to full photo/);
  assert.match(z, /priority=\{isActive \? 'high' : 'normal'\}/);
  assert.match(read('app/listing/gallery/[id].tsx'), /viewer: tap to mount/);
  assert.match(read('app/listing/[id].tsx'), /imageTimingStart\('viewer: tap to mount'\)/);
});

test('ZoomableImage: gestures are off while the error panel with Retry is showing', () => {
  const src = read('components/ZoomableImage.tsx');
  assert.match(src, /const gesturesOn = status !== 'error'/);
  assert.equal((src.match(/\.enabled\([^)]*gesturesOn\)/g) ?? []).length, 3, 'pinch, pan and double-tap are all gated');
});
