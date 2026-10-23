// LOCAL INTEGRATION test of the watermark asset and the JPEG metadata guard, using real image codecs (sharp, from
// web/node_modules) as a stand-in for the Cloudflare Images binding. It proves the pre-rendered tile and our byte
// checks behave on real pixels; it does NOT prove Cloudflare's renderer does the same — that is the staging test
// (docs/IMAGE_PARITY_STAGING_RUNBOOK.md). Skipped (not passed) when sharp isn't installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { watermarkLayout } from '../lib/imageSafety';
import { jpegMetaReport, stripJpegMetadata, needsRotation } from '../lib/jpegMeta';
import { markIsPresent } from '../workers/image-scan/src/pipeline';
import { TILE_FONT_SIZE, TILE_H, TILE_PNG_BASE64, TILE_W } from '../workers/image-scan/src/tile.generated';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharp: any = null;
try {
  sharp = require(path.join(__dirname, '..', '..', 'web', 'node_modules', 'sharp'));
} catch {
  sharp = null;
}
const skip = sharp ? false : 'sharp (web/node_modules) not installed';

/** Photo-like base: smooth gradient + deterministic noise, so a mark has texture to hide in. */
async function base(w: number, h: number, tone: 'mid' | 'light' | 'dark' = 'mid'): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 3);
  let seed = 12345;
  const lo = tone === 'light' ? 190 : tone === 'dark' ? 10 : 70;
  const hi = tone === 'light' ? 250 : tone === 'dark' ? 60 : 190;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const v = lo + ((hi - lo) * (x / w + y / h)) / 2 + ((seed >>> 24) % 12);
      const o = (y * w + x) * 3;
      px[o] = v; px[o + 1] = v * 0.9; px[o + 2] = v * 0.8;
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

/** Same operation the Worker's tile mode asks Cloudflare for: scale the tile to the layout's font size, repeat from the top-left. */
async function stampWithTile(jpeg: Buffer): Promise<Buffer> {
  const { width, height } = await sharp(jpeg).metadata();
  const scale = watermarkLayout(width, height).fontSize / TILE_FONT_SIZE;
  const tile = await sharp(Buffer.from(TILE_PNG_BASE64, 'base64')).resize({ width: Math.max(32, Math.round(TILE_W * scale)) }).png().toBuffer();
  return sharp(jpeg).composite([{ input: tile, tile: true }]).jpeg({ quality: 85 }).toBuffer();
}

const rgb = async (b: Buffer) => (await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true }));

async function changed(before: Buffer, after: Buffer, w: number, h: number, threshold = 14) {
  const a = (await rgb(before)).data;
  const b = (await rgb(after)).data;
  const quads = [0, 0, 0, 0];
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const d = Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]);
      if (d > threshold * 3) { total++; quads[(y < h / 2 ? 0 : 2) + (x < w / 2 ? 0 : 1)]++; }
    }
  }
  return { fraction: total / (w * h), quadrantFractions: quads.map((n) => n / ((w * h) / 4)) };
}

test('the committed tile is a real RGBA PNG with translucent mark pixels and fully transparent gaps', { skip }, async () => {
  const { data, info } = await sharp(Buffer.from(TILE_PNG_BASE64, 'base64')).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height, info.channels], [TILE_W, TILE_H, 4]);
  let transparent = 0, translucent = 0, opaque = 0;
  for (let i = 3; i < data.length; i += 4) { if (data[i] === 0) transparent++; else if (data[i] < 255) translucent++; else opaque++; }
  const n = data.length / 4;
  assert.ok(transparent / n > 0.8, 'most of the tile is untouched picture');
  assert.ok((translucent + opaque) / n > 0.04, 'the mark covers a visible share of the tile');
  assert.ok(opaque / n < 0.01, 'translucent, never solid');
  // seamless: the pixel columns/rows on opposite edges are equally empty (no mark is cut by an edge)
  const alpha = (x: number, y: number) => data[(y * TILE_W + x) * 4 + 3];
  for (let y = 0; y < TILE_H; y++) assert.ok(Math.abs(alpha(0, y) - alpha(TILE_W - 1, y)) < 40, `left/right edges differ at row ${y}`);
  for (let x = 0; x < TILE_W; x++) assert.ok(Math.abs(alpha(x, 0) - alpha(x, TILE_H - 1)) < 40, `top/bottom edges differ at column ${x}`);
});

const SIZES: [string, number, number][] = [['small landscape', 320, 240], ['small portrait', 240, 320], ['medium', 800, 600], ['large landscape', 1600, 1200], ['large portrait', 1200, 1600], ['panorama', 1600, 500], ['tall', 500, 1600]];

for (const [name, w, h] of SIZES) {
  test(`tile watermark on a ${name} (${w}x${h}): same size, visible everywhere, readable size`, { skip }, async () => {
    const photo = await base(w, h);
    const out = await stampWithTile(photo);
    const meta = await sharp(out).metadata();
    assert.deepEqual([meta.width, meta.height], [w, h], 'dimensions and orientation unchanged');
    const { fraction, quadrantFractions } = await changed(photo, out, w, h);
    assert.ok(fraction > 0.02 && fraction < 0.35, `mark covers ${(fraction * 100).toFixed(1)}% of pixels`);
    for (const q of quadrantFractions) assert.ok(q > 0.01, 'every quarter of the picture carries the mark (survives cropping)');
    assert.ok(watermarkLayout(w, h).fontSize >= 14, 'text height stays legible on small images');
    // The Worker's own verifier accepts it.
    const gray = async (b: Buffer) => Uint8Array.from((await sharp(b).resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer()) as Buffer);
    assert.equal(markIsPresent(await gray(photo), await gray(out)), true);
    // And it does NOT accept the unmarked picture.
    assert.equal(markIsPresent(await gray(photo), await gray(photo)), false);
  });
}

test('the mark is visible on light and on dark photos (white text with a dark halo)', { skip }, async () => {
  for (const tone of ['light', 'dark'] as const) {
    const photo = await base(800, 600, tone);
    const { fraction } = await changed(photo, await stampWithTile(photo), 800, 600, 10);
    assert.ok(fraction > 0.015, `${tone}: mark pixels ${(fraction * 100).toFixed(1)}%`);
  }
});

test('stamping an already-stamped derivative is detectable (the pipeline must always start from the original)', { skip }, async () => {
  const photo = await base(800, 600);
  const once = await stampWithTile(photo);
  const twice = await stampWithTile(once);
  const a = await changed(photo, once, 800, 600);
  const b = await changed(photo, twice, 800, 600);
  assert.ok(b.fraction > a.fraction, 'a double mark changes more pixels than a single one — this is the failure the pipeline avoids by never re-reading wm/ files');
});

// ── metadata, using EXIF written by a real encoder ─────────────────────────────────────────────────────────────
test('real EXIF: orientation and GPS are detected, and stripping is lossless and removes them', { skip }, async () => {
  const withMeta: Buffer = await sharp(await base(400, 300))
    .withExif({ IFD0: { Copyright: 'seller', Make: 'TestCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1' } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const report = jpegMetaReport(withMeta);
  assert.equal(report.valid, true);
  assert.equal(report.hasExif, true);
  assert.equal(report.orientation, 6);
  assert.equal(report.hasGps, true, 'GPS pointer in the EXIF block is found');
  assert.equal(needsRotation(report), true);

  const stripped = stripJpegMetadata(new Uint8Array(withMeta));
  assert.ok(stripped);
  const after = jpegMetaReport(stripped!);
  assert.deepEqual([after.valid, after.hasExif, after.hasGps, after.orientation], [true, false, false, 1]);
  const decoded = await sharp(Buffer.from(stripped!)).metadata();
  assert.ok(decoded.width && decoded.height, 'still decodes');
  // lossless: identical pixels before and after stripping (ignoring the orientation tag that was removed)
  const a = (await sharp(withMeta).raw().toBuffer()) as Buffer;
  const b = (await sharp(Buffer.from(stripped!)).raw().toBuffer()) as Buffer;
  assert.equal(a.length, b.length);
  assert.ok(a.equals(b), 'pixel data is byte-identical after stripping');
});

test('auto-rotating an EXIF-rotated photo gives upright pixels with no orientation tag left', { skip }, async () => {
  const sideways: Buffer = await sharp(await base(400, 300)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  assert.equal(needsRotation(jpegMetaReport(sideways)), true);
  const upright: Buffer = await sharp(sideways).rotate().jpeg().toBuffer(); // what a correct normalise step does
  const meta = await sharp(upright).metadata();
  assert.deepEqual([meta.width, meta.height], [300, 400], '400x300 + orientation 6 is a 300x400 portrait');
  assert.equal(needsRotation(jpegMetaReport(upright)), false);
});

test('jpegMetaReport / stripJpegMetadata refuse non-JPEG input', () => {
  const junk = new TextEncoder().encode('<html>');
  assert.equal(jpegMetaReport(junk).valid, false);
  assert.equal(stripJpegMetadata(junk), null);
  assert.equal(jpegMetaReport(new Uint8Array(0)).valid, false);
});
