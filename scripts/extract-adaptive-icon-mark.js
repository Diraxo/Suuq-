// Extract the SUUQIYE "F" mark + coral accent from fursad-logo.png onto a
// transparent canvas, dropping the blue rounded-square background, then
// place it inside Android's adaptive-icon safe zone.
const sharp = require('sharp');
const path = require('path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'assets', 'images', 'fursad-logo.png');
const OUT = path.join(ROOT, 'assets', 'images', 'fursad-adaptive-foreground.png');
const DEBUG_MASK = path.join(
  'C:\\Users\\abdir\\AppData\\Local\\Temp\\claude\\c--Users-abdir-OneDrive-Desktop-suuqplus-clean-FULL\\864a0f3b-e0e9-440f-a543-4dd5c0598480\\scratchpad',
  'mask-extracted.png'
);

const CANVAS = 1024;
// Android safe zone: content should stay inside a 66dp circle centered in the
// 108dp adaptive-icon canvas. Scale by radial distance (not bounding-box
// width/height) since a circle only touches the middle of each box edge,
// not its corners -- fitting to a square box alone still lets diagonal
// extents (like the coral bar's tip) poke outside the circle.
const SAFE_RADIUS = CANVAS * (66 / 108) / 2;
const SAFE_MARGIN = 0.98; // extra buffer inside the safe-zone circle

// Background blue sampled from fursad-logo.png interior (solid fill area)
const BG = { r: 61, g: 68, b: 185 };
const T1 = 20; // below this distance from BG => fully background (dropped)
const T2 = 110; // above this distance from BG => fully foreground (kept)

function colorDist(r, g, b) {
  const dr = r - BG.r, dg = g - BG.g, db = b - BG.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

async function main() {
  const srcImg = sharp(SRC).ensureAlpha();
  const { data, info } = await srcImg.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const si = i * channels;
    const r = data[si], g = data[si + 1], b = data[si + 2], a = data[si + 3];
    const oi = i * 4;
    if (a === 0) {
      out[oi + 3] = 0;
      continue;
    }
    const d = colorDist(r, g, b);
    let alpha;
    if (d <= T1) alpha = 0;
    else if (d >= T2) alpha = 255;
    else alpha = Math.round(((d - T1) / (T2 - T1)) * 255);
    out[oi] = r;
    out[oi + 1] = g;
    out[oi + 2] = b;
    out[oi + 3] = alpha;
  }

  // Slight blur smooths speckling in the original artwork's gradient/dither
  // that the hard color-distance mask would otherwise amplify into noise.
  const extracted = sharp(out, { raw: { width, height, channels: 4 } }).blur(1.2);

  // Trim margin to get a tight bounding box of the mark; a higher threshold
  // ignores the faint blur fringe so it doesn't inflate the bounding box.
  const trimmed = await extracted.png().trim({ threshold: 40 }).toBuffer();
  const trimmedMeta = await sharp(trimmed).metadata();
  console.log('Trimmed mark size:', trimmedMeta.width, 'x', trimmedMeta.height);

  await sharp(trimmed).toFile(DEBUG_MASK);

  // Find the maximum radial distance from the bounding-box center to any
  // non-transparent pixel, so scaling can guarantee the whole mark -- not
  // just its bounding box -- fits inside the safe-zone circle.
  const { data: trimmedData, info: trimmedInfo } = await sharp(trimmed)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const tw = trimmedInfo.width, th = trimmedInfo.height, tc = trimmedInfo.channels;
  const cx = tw / 2, cy = th / 2;
  let maxDist = 0;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const a = trimmedData[(y * tw + x) * tc + 3];
      if (a < 25) continue;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) maxDist = dist;
    }
  }
  console.log('Max radial extent of mark:', maxDist.toFixed(1), 'px (at trimmed scale)');

  const scale = (SAFE_RADIUS * SAFE_MARGIN) / maxDist;
  const fitW = Math.round(trimmedMeta.width * scale);
  const fitH = Math.round(trimmedMeta.height * scale);

  const resizedMark = await sharp(trimmed)
    .resize(fitW, fitH, { kernel: 'lanczos3' })
    .toBuffer();

  const left = Math.round((CANVAS - fitW) / 2);
  const top = Math.round((CANVAS - fitH) / 2);

  await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resizedMark, left, top }])
    .png()
    .toFile(OUT);

  console.log('Wrote', OUT, `(mark ${fitW}x${fitH} at ${left},${top})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
