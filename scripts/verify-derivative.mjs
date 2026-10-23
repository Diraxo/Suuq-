// Independent inspection of a published listing photo — the evidence step of the staging runbook
// (docs/IMAGE_PARITY_STAGING_RUNBOOK.md). It trusts NOTHING the pipeline reports: it downloads the bytes from the PUBLIC
// URL, decodes them with a different codec (sharp/libvips) and checks the pixels itself.
//
//   node scripts/verify-derivative.mjs <derivative URL or file> --original <the test photo you uploaded> [--expect-upright]
//        [--must-not-be-public <url> ...] [--json]
//
// Checks (each reported pass/fail; exit code 1 if any fails):
//   * public URL is under /wm/ and is a real JPEG
//   * no EXIF / GPS / XMP / IPTC / orientation tag in the bytes
//   * dimensions equal the original's upright dimensions (or fit inside 1600px with the same aspect ratio)
//   * a diagonal mark is present in the PIXELS: share of changed pixels in a sane band, present in every quarter
//   * the mark is not doubled (changed share is not far above one layer's expected range)
//   * every --must-not-be-public URL (originals, pending/ copies) answers 401/403/404, never 200
// Needs `sharp` (a dependency of web/) and Node >= 22.18 (imports the TypeScript metadata reader directly).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { jpegMetaReport } from '../lib/jpegMeta.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(path.join(root, 'web', 'package.json'))('sharp');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valueOf = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const multi = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
const target = args.find((a) => !a.startsWith('--') && a !== valueOf('--original') && !multi('--must-not-be-public').includes(a));
if (!target) {
  console.error('usage: node scripts/verify-derivative.mjs <url|file> --original <file> [--must-not-be-public <url>] [--json]');
  process.exit(2);
}

const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail });

const isUrl = /^https?:\/\//i.test(target);
let bytes;
if (isUrl) {
  const res = await fetch(target);
  check('derivative is publicly reachable', res.status === 200, `HTTP ${res.status}`);
  check('derivative lives under /wm/', new URL(target).pathname.includes('/wm/'), new URL(target).pathname);
  bytes = Buffer.from(await res.arrayBuffer());
} else {
  bytes = fs.readFileSync(target);
}

const meta = jpegMetaReport(new Uint8Array(bytes));
check('is a parseable JPEG', meta.valid);
check('no EXIF', !meta.hasExif);
check('no GPS', !meta.hasGps);
check('no XMP / IPTC / comment', !meta.hasXmp && !meta.hasIptc && !meta.hasComment);
check('no orientation tag left (pixels already upright)', meta.orientation === 1, `orientation ${meta.orientation}`);

const derivative = sharp(bytes);
const dm = await derivative.metadata();
check('decodes with an independent codec', !!dm.width && !!dm.height, `${dm.width}x${dm.height}`);

const originalPath = valueOf('--original');
if (originalPath) {
  const upright = sharp(fs.readFileSync(originalPath)).rotate(); // apply the original's EXIF orientation
  const om = await upright.clone().toBuffer({ resolveWithObject: true }).then((r) => r.info);
  const sameAspect = Math.abs(dm.width / dm.height - om.width / om.height) < 0.01;
  check('same aspect ratio and orientation as the upright original', sameAspect, `derivative ${dm.width}x${dm.height}, original ${om.width}x${om.height}`);
  check('not larger than the 1600px display size', Math.max(dm.width, dm.height) <= 1600);

  // Compare like with like: original resized to the derivative's size.
  const a = await upright.clone().resize(dm.width, dm.height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const b = await sharp(bytes).removeAlpha().raw().toBuffer();
  const w = dm.width;
  const h = dm.height;
  const quads = [0, 0, 0, 0];
  const lift = []; // for brightened pixels: how much of the way to white the mark pulled them (≈ the mark's opacity)
  let changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      // a threshold above JPEG re-compression noise (two lossy generations differ by a few levels)
      const d = Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]);
      if (d > 42) {
        changed++;
        if (b[o] > a[o] && b[o + 1] > a[o + 1] && b[o + 2] > a[o + 2] && a[o] < 235 && a[o + 1] < 235 && a[o + 2] < 235) {
          lift.push((((b[o] - a[o]) / (255 - a[o])) + ((b[o + 1] - a[o + 1]) / (255 - a[o + 1])) + ((b[o + 2] - a[o + 2]) / (255 - a[o + 2]))) / 3);
        }
        quads[(y < h / 2 ? 0 : 2) + (x < w / 2 ? 0 : 1)]++;
      }
    }
  }
  const share = changed / (w * h);
  const qShare = quads.map((n) => n / ((w * h) / 4));
  check('a mark is present in the pixels (changed share 2%–35%)', share >= 0.02 && share <= 0.35, `${(share * 100).toFixed(1)}% of pixels differ`);
  check('the mark reaches every quarter of the picture (survives cropping)', qShare.every((q) => q > 0.01), qShare.map((q) => `${(q * 100).toFixed(1)}%`).join(' / '));
  // Two stamps in the SAME place cover the same pixels, so coverage can't reveal them — but opacity compounds
  // (0.32 → 0.54 → 0.69). Strong interior pixels (90th percentile) tell one layer from several.
  lift.sort((x, y) => x - y);
  const p90 = lift.length ? lift[Math.floor(lift.length * 0.9)] : 0;
  check('mark strength matches ONE layer (opacity ≈ 0.32; not double-watermarked)', p90 >= 0.2 && p90 <= 0.42, `90th-percentile lift ${p90.toFixed(2)} (one layer ≈ 0.32, two ≈ 0.54)`);
}

for (const url of multi('--must-not-be-public')) {
  let status = 0;
  try {
    status = (await fetch(url, { method: 'GET' })).status;
  } catch {
    status = -1; // unreachable counts as not public
  }
  check(`NOT publicly readable: ${url}`, status === 401 || status === 403 || status === 404 || status === -1, `HTTP ${status}`);
}

const failed = checks.filter((c) => !c.pass);
if (flag('--json')) console.log(JSON.stringify({ target, bytes: bytes.length, checks, ok: failed.length === 0 }, null, 2));
else {
  console.log(`\nTarget: ${target} (${bytes.length} bytes)`);
  for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
  console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`);
}
process.exit(failed.length === 0 ? 0 : 1);
