// One-off script: rebuild the Android adaptive-icon foreground layer so the
// Fursad mark sits inside Android's safe zone instead of bleeding to the
// canvas edge (which caused the launcher icon to render zoomed/cropped).
const sharp = require('sharp');
const path = require('path');

const SRC = path.join(process.cwd(), 'assets', 'images', 'fursad-logo.png');
const OUT = path.join(process.cwd(), 'assets', 'images', 'fursad-adaptive-foreground.png');
const CANVAS = 1024;
const SAFE_RATIO = 0.66; // ~66% of the 108dp adaptive-icon canvas, matching Android's safe-zone guidance

async function main() {
  const target = Math.round(CANVAS * SAFE_RATIO);
  const offset = Math.round((CANVAS - target) / 2);

  const resizedBadge = await sharp(SRC)
    .resize(target, target, { fit: 'contain', kernel: 'lanczos3' })
    .toBuffer();

  await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resizedBadge, left: offset, top: offset }])
    .png()
    .toFile(OUT);

  console.log('Wrote', OUT, `(badge inset to ${target}x${target}, margin ${offset}px each side)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
