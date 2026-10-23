// LOCAL self-test of scripts/verify-derivative.mjs: proves the inspector accepts a correct derivative and REJECTS the
// four wrong ones it exists to catch (unmarked, double-marked, metadata left in, sideways). Uses sharp + the committed
// PNG tile as a stand-in for the Cloudflare renderer — so this tests the INSPECTOR, not Cloudflare.
//   node scripts/verify-derivative.selftest.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { watermarkLayout } from '../lib/imageSafety.ts';
import { stripJpegMetadata } from '../lib/jpegMeta.ts';
import { TILE_FONT_SIZE, TILE_PNG_BASE64, TILE_W } from '../workers/image-scan/src/tile.generated.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(path.join(root, 'web', 'package.json'))('sharp');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-derivative-'));

// A photo-like 1200x900 original stored SIDEWAYS (EXIF orientation 6 → upright it is 900x1200) with GPS.
const w = 1200, h = 900;
const px = Buffer.alloc(w * h * 3);
let seed = 99;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const v = 60 + 120 * ((x / w + y / h) / 2) + ((seed >>> 24) % 14);
  const o = (y * w + x) * 3; px[o] = v; px[o + 1] = v * 0.85; px[o + 2] = v * 0.7;
}
const original = await sharp(px, { raw: { width: w, height: h, channels: 3 } })
  .withExif({ IFD0: { Make: 'TestCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1' } })
  .withMetadata({ orientation: 6 }).jpeg({ quality: 92 }).toBuffer();
const originalPath = path.join(dir, 'original.jpg');
fs.writeFileSync(originalPath, original);

const upright = await sharp(original).rotate().jpeg({ quality: 90 }).toBuffer(); // what a correct normalise step produces
const um = await sharp(upright).metadata();
const scale = watermarkLayout(um.width, um.height).fontSize / TILE_FONT_SIZE;
const tile = await sharp(Buffer.from(TILE_PNG_BASE64, 'base64')).resize({ width: Math.round(TILE_W * scale) }).png().toBuffer();
const stamp = (buf) => sharp(buf).composite([{ input: tile, tile: true }]).jpeg({ quality: 85 }).toBuffer();

const marked = await stamp(upright);
const cases = {
  correct: stripJpegMetadata(new Uint8Array(marked)),
  unmarked: stripJpegMetadata(new Uint8Array(await sharp(upright).jpeg({ quality: 85 }).toBuffer())),
  doubled: stripJpegMetadata(new Uint8Array(await stamp(await stamp(await stamp(marked))))),
  'metadata left in': new Uint8Array(await sharp(marked).withExif({ IFD0: { Make: 'TestCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } }).jpeg().toBuffer()),
  sideways: stripJpegMetadata(new Uint8Array(await sharp(marked).rotate(90).jpeg().toBuffer())),
};

let bad = 0;
for (const [name, bytes] of Object.entries(cases)) {
  const file = path.join(dir, `${name.replace(/\W+/g, '_')}.jpg`);
  fs.writeFileSync(file, bytes);
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/verify-derivative.mjs'), file, '--original', originalPath, '--json'], { encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  const failedChecks = out.checks.filter((c) => !c.pass).map((c) => c.name);
  const expectPass = name === 'correct';
  const verdictOk = expectPass ? out.ok : !out.ok;
  if (!verdictOk) bad++;
  console.log(`${verdictOk ? 'OK  ' : 'BAD '} ${name.padEnd(17)} inspector says ${out.ok ? 'PASS' : 'FAIL'}${failedChecks.length ? `  (${failedChecks.join('; ')})` : ''}`);
}
console.log(bad === 0 ? '\nSELF-TEST PASSED: the inspector accepts the correct derivative and rejects all four wrong ones' : `\nSELF-TEST FAILED (${bad})`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(bad === 0 ? 0 : 1);
