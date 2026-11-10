// The full-screen photo viewer must never trap the person: the close button exists in every state, and a photo that stalls,
// fails or is swapped mid-load always leaves the loading state. Reported on TestFlight: black viewer, permanent spinner,
// scrolling and X unresponsive on a five-photo listing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nextViewerImageStatus, viewerCellBuilt, viewerLayers, viewerState, VIEWER_BUILD_RADIUS, VIEWER_IMAGE_TIMEOUT_MS, VIEWER_WINDOW } from '../lib/viewerImage';

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

test('the viewer builds only the open photo and its neighbours; every other cell is an empty shell', () => {
  assert.ok(VIEWER_BUILD_RADIUS <= 2);
  // before the open photo has had the screen to itself, only it is built
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => viewerCellBuilt(i, 2, false)), [false, false, true, false, false]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => viewerCellBuilt(i, 3, true)), [false, true, true, true, true, true, false]);
  assert.equal([0, 1, 2, 3, 4, 5, 6, 7].filter((i) => viewerCellBuilt(i, 0, true)).length, 3);
});

test('the viewer list keeps every cell mounted so a swipe never mounts one', () => {
  const src = read('app/listing/gallery/[id].tsx');
  assert.ok(VIEWER_WINDOW.windowSize >= 17, 'window covers all 8 photos');
  assert.match(src, /initialNumToRender=\{listing\.images\.length\}/);
  assert.match(src, /viewerCellBuilt\(i, active, warm\)/);
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

// Regression guard only (source text): it cannot prove touch behaviour, which needs a physical device.
test('gallery route: the close button is not conditional on zoom or the listing, and sits above everything', () => {
  const src = read('app/listing/gallery/[id].tsx');
  const start = src.lastIndexOf('<Pressable', src.indexOf("router.back()}"));
  const end = src.indexOf('</Pressable>', start);
  const block = src.slice(start, end);
  assert.ok(!/zoomed|listing/.test(src.slice(src.lastIndexOf('\n', start - 1) - 40, start)), 'no condition may wrap the close button');
  assert.match(block, /zIndex: 10/);
  assert.match(block, /width: 44, height: 44/);
  assert.match(block, /hitSlop=\{8\}/);
  assert.match(block, /top: insets\.top \+ 12/);
  assert.match(block, /accessibilityRole="button"/);
});

test('ZoomableImage: timeout, retry, and the error state is not a dead end', () => {
  const src = read('components/ZoomableImage.tsx');
  assert.match(src, /VIEWER_IMAGE_TIMEOUT_MS/);
  assert.match(src, /'timeout'/);
  assert.match(src, /setAttempt/);
  assert.ok(!/setStatus\('(loaded|error|loading)'\)/.test(src), 'status changes go through nextViewerImageStatus');
  // The spinner never intercepts touches.
  assert.match(src, /spinnerOn && wantSpinner && \(\s*<View style=\{\{ position: 'absolute' \}\} pointerEvents="none">/);
});

test('viewer opens with the cached card-size photo under the full one, and logs tap timings', () => {
  const z = read('components/ZoomableImage.tsx');
  assert.match(z, /imageUrl\(uri, \{ size: 'card' \}\)/);
  assert.match(z, /viewer: tap to preview/);
  assert.match(z, /viewer: tap to full photo/);
  assert.match(z, /priority=\{isActive \? 'high' : 'normal'\}/);
  assert.match(read('app/listing/gallery/[id].tsx'), /viewer: tap to mount/);
  assert.match(read('app/listing/[id].tsx'), /imageTimingStart\(`viewer: tap to \$\{label\}`\)/);
});

test('ZoomableImage: gestures are off while the error panel with Retry is showing', () => {
  const src = read('components/ZoomableImage.tsx');
  assert.match(src, /const gesturesOn = status !== 'error'/);
  assert.equal((src.match(/\.enabled\([^)]*gesturesOn\)/g) ?? []).length, 3, 'pinch, pan and double-tap are all gated');
});

test('watermark-safe visibility: a photo needing the overlay is never visible without it', () => {
  for (const status of ['loading', 'loaded', 'error'] as const) for (const hasSize of [false, true]) for (const hasPlaceholder of [false, true]) {
    const l = viewerLayers({ status, hasSize, bakedWatermark: false, hasPlaceholder });
    assert.equal(l.photo, l.watermark, `photo and mark appear together (${status}, size ${hasSize})`);
    assert.equal(l.photo, hasSize, 'shown from the first load event that reports a size, and not before');
  }
});

test('identical preview and full URLs: the blur shows at once, then the photo and its mark in the same step', () => {
  // No size yet (nothing but the full photo is loading): placeholder only, photo hidden.
  const early = viewerLayers({ status: 'loading', hasSize: false, bakedWatermark: false, hasPlaceholder: true });
  assert.deepEqual(early, { photo: false, watermark: false, backdrop: true });
  const done = viewerLayers({ status: 'loaded', hasSize: true, bakedWatermark: false, hasPlaceholder: true, displayed: true });
  assert.deepEqual(done, { photo: true, watermark: true, backdrop: false });
  // Without a placeholder nothing is drawn early (the spinner still shows), so no unmarked photo and no empty backdrop.
  assert.deepEqual(viewerLayers({ status: 'loading', hasSize: false, bakedWatermark: false, hasPlaceholder: false }), { photo: false, watermark: false, backdrop: false });
});

test('baked-in watermark: the photo is visible at once, no overlay is added, and the stand-in stays until the photo is displayed', () => {
  assert.deepEqual(viewerLayers({ status: 'loading', hasSize: false, bakedWatermark: true, hasPlaceholder: true }), { photo: true, watermark: false, backdrop: true });
  assert.deepEqual(viewerLayers({ status: 'loaded', hasSize: false, bakedWatermark: true, hasPlaceholder: true, displayed: true }), { photo: true, watermark: false, backdrop: false });
});

test('failure and retry: the blur is not left over a failed photo and comes back while retrying', () => {
  assert.equal(viewerLayers({ status: 'error', hasSize: false, bakedWatermark: false, hasPlaceholder: true }).backdrop, false);
  assert.equal(viewerLayers({ status: nextViewerImageStatus('error', 'start'), hasSize: false, bakedWatermark: false, hasPlaceholder: true }).backdrop, true);
});

test('ZoomableImage wiring: photo opacity and overlay come from viewerLayers, URLs are never logged', () => {
  const src = read('components/ZoomableImage.tsx');
  assert.match(src, /opacity: layers\.photo \? 1 : 0/);
  assert.match(src, /natural && layers\.watermark/);
  assert.match(src, /layers\.backdrop/);
  assert.ok(!/console\.(error|log|warn)\([^)]*(resolvedUri|previewUri|uri)/.test(src), 'no URL in logs');
  for (const label of ['tap to watermark', 'tap to full photo loaded', 'tap to full photo displayed']) assert.match(src, new RegExp(`viewer: ${label}`));
});

// Source text only: the race itself (onLoad before the passive effect flushes) needs a device or a React Native renderer.
test('ZoomableImage: the request-reset effect does not run on mount, so an early onLoad cannot be overwritten', () => {
  const src = read('components/ZoomableImage.tsx');
  const start = src.indexOf('const requestKey = useRef');
  assert.ok(start > 0, 'mount guard present');
  const effect = src.slice(start, src.indexOf('}, [resolvedUri, attempt]);', start));
  assert.match(effect, /if \(requestKey\.current === key\) return;/);
  assert.ok(effect.indexOf('requestKey.current === key') < effect.indexOf("'start'"), 'guard comes before the reset');
  assert.match(effect, /setNatural\(knownImageSize\(uri\)\)/);
});
