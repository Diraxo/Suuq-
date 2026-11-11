// Gallery rendering: black gap, watermark cost, repeat openings, preparation order, diagnostics.
// Pure logic runs for real; the wiring checks read source text, because the black screen itself (a native rendering matter)
// can only be confirmed on a physical iPhone. These tests cannot establish that it is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { watermarkLayout } from '../lib/imageSafety';
import { visibleWatermarkItems } from '../lib/watermarkCull';
import { galleryPrefetchOrder, knownImageSize, redactImageUrl, rememberImageSize, viewerLayers, VIEWER_SPINNER_DELAY_MS } from '../lib/viewerImage';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

// ── watermark cost ──
test('culling keeps every tile that can be seen and drops a large share of the rest', () => {
  for (const [w, h] of [[1280, 960], [960, 1280], [1280, 720], [600, 600], [1600, 1200]]) {
    const layout = watermarkLayout(w, h);
    const kept = visibleWatermarkItems(layout, w, h);
    const rad = (layout.angle * Math.PI) / 180;
    const inside = layout.items.filter((p) => {
      const x = w / 2 + p.x * Math.cos(rad) - p.y * Math.sin(rad);
      const y = h / 2 + p.x * Math.sin(rad) + p.y * Math.cos(rad);
      return x >= 0 && x <= w && y >= 0 && y <= h;
    });
    for (const p of inside) assert.ok(kept.includes(p), `a tile centred inside the picture must be kept (${w}x${h})`);
    assert.ok(kept.length <= layout.items.length);
    assert.ok(kept.length < layout.items.length * 0.7, `expected a real saving at ${w}x${h}: ${kept.length}/${layout.items.length}`);
  }
});

test('culling is a no-op for a degenerate size and never mutates the shared layout', () => {
  const layout = watermarkLayout(800, 600);
  const before = layout.items.length;
  assert.equal(visibleWatermarkItems(layout, 0, 0), layout.items);
  visibleWatermarkItems(layout, 800, 600);
  assert.equal(layout.items.length, before);
});

// ── remembered size: the mark no longer waits for the viewer's own load event ──
test('a remembered photo size is returned for the same photo and rejected when invalid', () => {
  assert.equal(knownImageSize('https://x.test/a.jpg'), null);
  rememberImageSize('https://x.test/a.jpg', 1280, 960);
  assert.deepEqual(knownImageSize('https://x.test/a.jpg'), { w: 1280, h: 960 });
  for (const bad of [[0, 5], [5, 0], [-1, 5], [NaN, 5], [Infinity, 5], [undefined, 5], ['5', 5]] as const) {
    rememberImageSize('https://x.test/bad.jpg', bad[0], bad[1]);
    assert.equal(knownImageSize('https://x.test/bad.jpg'), null);
  }
});

test('the size memory is bounded', () => {
  for (let i = 0; i < 500; i++) rememberImageSize(`https://x.test/p${i}.jpg`, 10, 10);
  assert.equal(knownImageSize('https://x.test/p0.jpg'), null);
  assert.deepEqual(knownImageSize('https://x.test/p499.jpg'), { w: 10, h: 10 });
});

test('with a remembered size, photo and mark stay hidden until a real photo layer has loaded, then appear together; the stand-in stays until the photo is displayed', () => {
  const waiting = viewerLayers({ status: 'loading', hasSize: true, bakedWatermark: false, hasPlaceholder: true, painted: false });
  assert.deepEqual(waiting, { photo: false, watermark: false, backdrop: true });
  const first = viewerLayers({ status: 'loading', hasSize: true, bakedWatermark: false, hasPlaceholder: true, painted: true });
  assert.deepEqual(first, { photo: true, watermark: true, backdrop: true });
  const shown = viewerLayers({ status: 'loaded', hasSize: true, bakedWatermark: false, hasPlaceholder: true, displayed: true, painted: true });
  assert.deepEqual(shown, { photo: true, watermark: true, backdrop: false });
});

test('there is never a state with a visible photo that needs a mark but has none', () => {
  for (const status of ['loading', 'loaded', 'error'] as const) for (const hasSize of [false, true]) for (const displayed of [false, true]) for (const painted of [false, true]) {
    const l = viewerLayers({ status, hasSize, bakedWatermark: false, hasPlaceholder: true, displayed, painted });
    assert.equal(l.photo, l.watermark);
  }
});

// ── gallery preparation order ──
test('preparation order: open photo, next, previous, then outward; every photo exactly once', () => {
  assert.deepEqual(galleryPrefetchOrder(5, 0), [0, 1, 2, 3, 4]);
  assert.deepEqual(galleryPrefetchOrder(5, 2), [2, 3, 1, 4, 0]);
  assert.deepEqual(galleryPrefetchOrder(5, 4), [4, 3, 2, 1, 0]);
  assert.deepEqual(galleryPrefetchOrder(1, 0), [0]);
  assert.deepEqual(galleryPrefetchOrder(0, 0), []);
  for (let count = 1; count <= 8; count++) for (let a = -1; a <= count; a++) {
    const o = galleryPrefetchOrder(count, a);
    assert.equal(new Set(o).size, count);
    assert.ok(o.every((i) => i >= 0 && i < count));
  }
});

// ── diagnostics never leak a signed URL ──
test('redactImageUrl keeps host and file name only', () => {
  const r = redactImageUrl('https://user:pw@cdn.example.com/wm/listings/u1/l1/abc.jpg?X-Amz-Signature=SECRET&token=T#frag');
  assert.equal(r, 'cdn.example.com/…/abc.jpg');
  assert.ok(!/SECRET|token|pw|Signature|frag/.test(r));
  assert.equal(redactImageUrl('not a url'), '(unparsable)');
});

test('the spinner is delayed so a cached photo never flashes one', () => {
  assert.ok(VIEWER_SPINNER_DELAY_MS >= 150 && VIEWER_SPINNER_DELAY_MS <= 600);
});

// ── wiring (source text) ──
test('ZoomableImage: opacity gate is separate from the Reanimated node, backdrop waits for a committed frame, size is remembered', () => {
  const z = read('components/ZoomableImage.tsx');
  assert.match(z, /<View style=\{\{ width, height, opacity: layers\.photo \? 1 : 0 \}\}>\s*<Animated\.View style=\{\[\{ width, height \}, animatedStyle\]\}>/);
  assert.match(z, /displayed: fullDisplayed/);
  assert.equal((z.match(/requestAnimationFrame/g) ?? []).length, 2, 'two frames after onDisplay');
  assert.match(z, /onDisplay=\{onFullDisplay\}/);
  assert.ok(!/onDisplay=\{\(\) => \{\s*setFullDisplayed\(true\)/.test(z), 'onDisplay alone must not drop the stand-in');
  assert.match(z, /knownImageSize\(uri\)/);
  assert.match(z, /rememberImageSize\(uri,/);
  assert.match(z, /cancelFrames\(\)/);
});

test('ZoomableImage: a retry or swapped photo resets every readiness flag, so nothing stale keeps the layers wrong', () => {
  const z = read('components/ZoomableImage.tsx');
  const a = z.indexOf('const requestKey = useRef');
  const effect = z.slice(a, z.indexOf('}, [resolvedUri, attempt]);', a));
  for (const reset of ['cancelFrames()', "nextViewerImageStatus(s, 'start')", 'setNatural(knownImageSize(uri))', 'setFullDisplayed(false)', 'setPreviewReady(false)']) assert.ok(effect.includes(reset), reset);
});

test('diagnostics: every lifecycle step is logged, and no raw URL is passed to a log', () => {
  const z = read('components/ZoomableImage.tsx');
  for (const ev of ['photo view mounted', 'photo view unmounted', 'active index changed', 'photo layer committed', 'watermark layer committed', 'image request started', 'image loaded', 'native display callback', 'stand-in and preview removed', 'spinner shown', 'spinner hidden', 'preview loaded']) assert.ok(z.includes(`'${ev}'`) || z.includes(ev), ev);
  const g = read('app/listing/gallery/[id].tsx');
  for (const ev of ['viewer mounted', 'viewer index changed', 'listing ready', 'viewer unmounted']) assert.ok(g.includes(ev), ev);
  assert.match(read('app/listing/[id].tsx'), /imageDiag\('tap received'/);
  const pf = read('lib/imagePrefetch.ts');
  assert.match(pf, /prefetch requested/);
  assert.match(pf, /prefetch completed/);
  // The only URL-derived value in any diagnostic goes through redactImageUrl.
  assert.match(z, /src: __DEV__ \? redactImageUrl\(resolvedUri\)/);
  assert.match(pf, /host: redactImageUrl\(url\)/);
  for (const src of [z, pf]) for (const m of src.matchAll(/(?:imageDiag|diag)\('[^']*', \{[^}]*\}/g)) {
    const fields = m[0].replace(/redactImageUrl\([^)]*\)/g, '');
    assert.ok(!/(?:uri|url|source)\s*:|\$\{/.test(fields) && !/:\s*(?:resolvedUri|previewUri|uri|url)/.test(fields), m[0]);
  }
  const t = read('lib/imageTiming.ts');
  assert.match(t, /export function imageDiag\(/);
  assert.match(t, /if \(!__DEV__/);
});

test('gallery prefetch: listing page prepares quietly after the hero paints, the viewer opens at top priority, one shared queue, no fan-out', () => {
  const d = read('app/listing/[id].tsx');
  assert.match(d, /if \(heroLoaded && heroImages\?\.length\) prefetchGalleryPhotos\(heroImages, activeImage\)/);
  assert.match(d, /prefetchGalleryPhotos\(foundListing\.images, index, \{ opened: true \}\)/, 'a tap on a photo opens the viewer at top priority');
  const g = read('app/listing/gallery/[id].tsx');
  assert.match(g, /prefetchGalleryPhotos\(images, active, \{ opened: true \}\)/);
  assert.match(g, /useEffect\(\(\) => cancelGalleryPrefetch, \[\]\)/, 'closing the viewer withdraws its queued work');
  assert.ok(!/Image\.prefetch/.test(g));
  const pf = read('lib/imagePrefetch.ts');
  assert.match(pf, /\{ size: 'full' \}/, 'the exact URL the viewer requests (1600)');
  assert.ok(!/BATCH|generation/.test(pf), 'no private batching: the shared queue orders everything');
});

test('splash: the logo is a bundled asset, hands off from its display, and has a short fallback', () => {
  const s = read('app/index.tsx');
  assert.match(s, /require\('@\/assets\/images\/fursad-splash\.png'\)/);
  assert.match(s, /onDisplay=\{\(\) => \{ SplashScreen\.hideAsync\(\)/);
  assert.match(s, /SPLASH_HANDOFF_FALLBACK_MS = 1500/);
  assert.match(s, /clearTimeout\(handoffFallback\)/);
  assert.match(read('app/_layout.tsx'), /setTimeout\(\(\) => SplashScreen\.hideAsync\(\)\.catch\(\(\) => \{\}\), 6000\)/);
  assert.ok(!/uri:\s*['"]https?:/.test(s.slice(s.indexOf('export default function Splash'))), 'no network logo');
});
