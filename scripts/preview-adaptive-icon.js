// Render composite previews of the adaptive icon (background + foreground)
// through circle, squircle, and square masks so the result can be inspected
// visually before shipping. Debug-only; does not modify any shipped asset.
const sharp = require('sharp');
const path = require('path');

const ROOT = process.cwd();
const FG = path.join(ROOT, 'assets', 'images', 'fursad-adaptive-foreground.png');
const OUT_DIR = process.argv[2];
const CANVAS = 1024;
const BG_COLOR = '#3F46BB';

function circleMask() {
  return Buffer.from(
    `<svg width="${CANVAS}" height="${CANVAS}"><circle cx="${CANVAS / 2}" cy="${CANVAS / 2}" r="${CANVAS / 2}" fill="#fff"/></svg>`
  );
}
function squircleMask() {
  const r = CANVAS * 0.45;
  return Buffer.from(
    `<svg width="${CANVAS}" height="${CANVAS}"><rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
  );
}
function squareMask() {
  return Buffer.from(
    `<svg width="${CANVAS}" height="${CANVAS}"><rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" fill="#fff"/></svg>`
  );
}
// Android safe-zone guide: 66dp circle centered in the 108dp canvas.
function safeZoneGuide() {
  const r = CANVAS * (66 / 108) / 2;
  return Buffer.from(
    `<svg width="${CANVAS}" height="${CANVAS}"><circle cx="${CANVAS / 2}" cy="${CANVAS / 2}" r="${r}" fill="none" stroke="#00FF00" stroke-width="4" stroke-dasharray="16,12"/></svg>`
  );
}

async function composeMasked(maskSvg, outFile, withGuide) {
  const base = sharp({
    create: { width: CANVAS, height: CANVAS, channels: 4, background: BG_COLOR },
  })
    .composite([{ input: FG, left: 0, top: 0 }])
    .png()
    .toBuffer();

  const mask = await sharp(maskSvg).png().toBuffer();

  let img = sharp(await base).composite([{ input: mask, blend: 'dest-in' }]);
  const composited = await img.png().toBuffer();

  const layers = [{ input: composited, left: 0, top: 0 }];
  if (withGuide) layers.push({ input: await sharp(safeZoneGuide()).png().toBuffer(), left: 0, top: 0 });

  await sharp({
    create: { width: CANVAS, height: CANVAS, channels: 4, background: '#EEEEEE' },
  })
    .composite(layers)
    .png()
    .toFile(outFile);
}

async function main() {
  await composeMasked(circleMask(), path.join(OUT_DIR, 'preview-circle.png'), true);
  await composeMasked(squircleMask(), path.join(OUT_DIR, 'preview-squircle.png'), true);
  await composeMasked(squareMask(), path.join(OUT_DIR, 'preview-square.png'), true);
  console.log('Wrote previews to', OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
