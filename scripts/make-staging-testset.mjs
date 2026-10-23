// Generates a LAWFUL, NON-SENSITIVE image set for the staging watermark/metadata tests
// (docs/IMAGE_PARITY_STAGING_RUNBOOK.md §4). Every image is synthetic (gradients, noise, flat colour, plain text) — no
// people, no real photos, no user data, nothing adult/violent, nothing that could be mistaken for a minor. They exercise
// the PIPELINE (size, orientation, metadata, formats, watermark) — not the moderation model: for a real "approved"
// outcome you also need a few ordinary product photos you took yourself (see the runbook).
//
//   node scripts/make-staging-testset.mjs <outDir>
//
// Writes the images plus manifest.json (what each file is for and what the pipeline must do with it).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(path.join(root, 'web', 'package.json'))('sharp');
const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/make-staging-testset.mjs <outDir>');
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });

/** Smooth gradient + noise: enough texture for a mark to be visible/measurable. `hue` varies the colours per image. */
function raw(w, h, hue = 0, tone = 1) {
  const px = Buffer.alloc(w * h * 3);
  let seed = 1234 + hue * 77;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const base = (60 + 120 * ((x / w + y / h) / 2)) * tone + ((seed >>> 24) % 14);
      const o = (y * w + x) * 3;
      px[o] = Math.min(255, base * (0.8 + 0.2 * Math.sin(hue)));
      px[o + 1] = Math.min(255, base * (0.8 + 0.2 * Math.sin(hue + 2)));
      px[o + 2] = Math.min(255, base * (0.8 + 0.2 * Math.sin(hue + 4)));
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } });
}
const GPS = { IFD0: { Make: 'StagingTestCam', Copyright: 'synthetic test image' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1' } };

const manifest = [];
async function add(name, purpose, expect, make) {
  fs.writeFileSync(path.join(out, name), await make());
  manifest.push({ file: name, purpose, expect });
}

await add('landscape-1600x1200.jpg', 'ordinary landscape, exactly the display size', 'derivative 1600x1200, mark everywhere', () => raw(1600, 1200, 1).jpeg({ quality: 90 }).toBuffer());
await add('portrait-1200x1600.jpg', 'ordinary portrait', 'derivative 1200x1600 (not rotated), mark everywhere', () => raw(1200, 1600, 2).jpeg({ quality: 90 }).toBuffer());
await add('small-320x240.jpg', 'very small image', 'refused if under the app minimum (480px) on the CLIENT; if sent directly the Worker accepts it and the mark must still be readable', () => raw(320, 240, 3).jpeg({ quality: 90 }).toBuffer());
await add('medium-800x600.jpg', 'medium image', 'derivative 800x600', () => raw(800, 600, 4).jpeg({ quality: 90 }).toBuffer());
await add('large-4000x3000.jpg', 'camera-sized image', 'normalised down to 1600x1200 (aspect kept)', () => raw(4000, 3000, 5).jpeg({ quality: 88 }).toBuffer());
await add('panorama-1600x500.jpg', 'extreme aspect ratio', 'derivative 1600x500, mark in every quarter', () => raw(1600, 500, 6).jpeg({ quality: 90 }).toBuffer());
await add('tall-500x1600.jpg', 'extreme tall aspect ratio', 'derivative 500x1600', () => raw(500, 1600, 7).jpeg({ quality: 90 }).toBuffer());
for (const [o, w, h] of [[6, 1200, 900], [3, 1200, 900], [8, 1200, 900]]) {
  await add(`exif-orientation-${o}-with-gps.jpg`, `stored ${w}x${h} with EXIF orientation ${o} AND GPS coordinates`, `UPRIGHT in the derivative ${o === 3 ? `${w}x${h}` : `${h}x${w}`}; no EXIF/GPS/orientation tag left`, () =>
    raw(w, h, 8 + o).withExif(GPS).withMetadata({ orientation: o }).jpeg({ quality: 90 }).toBuffer());
}
await add('png-800x600.png', 'PNG input', 'accepted; derivative is a JPEG', () => raw(800, 600, 20).png().toBuffer());
await add('webp-800x600.webp', 'WebP input', 'accepted; derivative is a JPEG', () => raw(800, 600, 21).webp().toBuffer());
await add('flat-screenshot-like-900x1600.png', 'flat colour, UI-like (low texture)', 'accepted; mark still measurable on flat areas', () =>
  sharp({ create: { width: 900, height: 1600, channels: 3, background: { r: 240, g: 240, b: 245 } } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600"><rect x="40" y="80" width="820" height="120" fill="#cfd8e3"/><rect x="40" y="260" width="820" height="900" fill="#ffffff"/></svg>`), top: 0, left: 0 }])
    .png().toBuffer());
await add('own-brand-text-800x600.jpg', 'contains the word "Suuqiye" as large plain text', 'rejected by the OCR own-watermark rule (watermark_own) — proves a downloaded marked photo cannot be re-uploaded and double-marked', () =>
  raw(800, 600, 30, 1.2).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><text x="400" y="320" font-size="110" font-weight="700" text-anchor="middle" font-family="Arial" fill="#ffffff" stroke="#000" stroke-width="4">Suuqiye</text></svg>`), top: 0, left: 0 }]).jpeg({ quality: 90 }).toBuffer());
await add('not-an-image.jpg', 'a text file named .jpg', 'refused (unsupported_image) before any storage or provider call', async () => Buffer.from('<html>this is not an image</html>'));
await add('truncated.jpg', 'a JPEG cut off mid-file', 'refused (unsupported_image)', async () => (await raw(800, 600, 40).jpeg().toBuffer()).subarray(0, 4000));
await add('duplicate-of-landscape-1600x1200.jpg', 're-encoded copy of landscape-1600x1200.jpg', 'second listing by ANOTHER test user → duplicate_listing (review); same user → ignored', () =>
  raw(1600, 1200, 1).jpeg({ quality: 70 }).toBuffer());

fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`wrote ${manifest.length} files + manifest.json to ${out}`);
