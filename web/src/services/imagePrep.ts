// Browser-side image intake for every upload on the website (Sell photos, Edit
// Listing photos, chat/avatar via services/r2.ts). Mirrors what the mobile app
// does with lib/imageValidation.ts + lib/imagePipeline.ts:
//   1. size / emptiness check,
//   2. the real container format is identified from the file's BYTES against
//      an allowlist (JPEG / PNG / WebP / HEIC) — the file name, extension and
//      File.type the browser reports are ignored, so a renamed text file, JSON,
//      PDF, SVG or script is rejected here,
//   3. the browser's own image decoder must actually decode it (createImageBitmap
//      — never an <img> tag, so SVG is not a path in),
//   4. it is redrawn onto a canvas and re-encoded as a plain JPEG capped at
//      1280px — which also drops EXIF/GPS metadata and any trailing payload
//      bytes — and that JPEG is the only thing ever uploaded.
// None of this is a security boundary on its own (a hand-written request skips
// the website entirely) — the trusted check is supabase/functions/r2-verify-images.
import { checkImageBytes, describeImageRejection, MAX_IMAGE_BYTES } from '@/lib/imageBytes';

export const MAX_SIDE = 1280;
export const JPEG_QUALITY = 0.7;
// Same floor as the mobile app (lib/imageValidation.ts MIN_DIMENSION).
export const MIN_DIMENSION = 480;

export class ImageRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageRejectedError';
  }
}

// Blobs produced by prepareImage(), so uploadToR2() can tell an already
// validated+re-encoded JPEG from a raw File and never skips the intake step.
const prepared = new WeakSet<Blob>();
export const isPreparedImage = (blob: Blob) => prepared.has(blob);

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImageRejectedError('That photo could not be processed. Try a different one.'))), 'image/jpeg', quality);
  });
}

export type PrepareOptions = {
  skipMinDimension?: boolean;
  /** Centre-crop to this width/height ratio first (1 = square avatar/logo, 16/9 = banner), like the mobile picker's crop step. */
  aspect?: number;
  /** Longest side of the output; defaults to MAX_SIDE. Profile images use far less than listing photos. */
  maxSide?: number;
  /** JPEG quality 0..1; defaults to JPEG_QUALITY. */
  quality?: number;
};

export async function prepareImage(file: Blob, opts: PrepareOptions = {}): Promise<File> {
  if (file.size === 0) throw new ImageRejectedError(describeImageRejection('empty'));
  if (file.size > MAX_IMAGE_BYTES) throw new ImageRejectedError(describeImageRejection('too-large'));

  const check = checkImageBytes(new Uint8Array(await file.arrayBuffer()));
  if (!check.ok) throw new ImageRejectedError(describeImageRejection(check.reason));

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageRejectedError("That photo couldn't be opened. It may be damaged, or your browser can't read this format.");
  }
  try {
    if (!opts.skipMinDimension && (bitmap.width < MIN_DIMENSION || bitmap.height < MIN_DIMENSION)) {
      throw new ImageRejectedError(`Photos must be at least ${MIN_DIMENSION}px on each side.`);
    }
    // Source rectangle: the whole image, or its centred crop to the requested aspect ratio.
    let sx = 0;
    let sy = 0;
    let sw = bitmap.width;
    let sh = bitmap.height;
    if (opts.aspect && opts.aspect > 0) {
      if (sw / sh > opts.aspect) {
        sw = Math.round(sh * opts.aspect);
        sx = Math.round((bitmap.width - sw) / 2);
      } else {
        sh = Math.round(sw / opts.aspect);
        sy = Math.round((bitmap.height - sh) / 2);
      }
    }
    const scale = Math.min(1, (opts.maxSide ?? MAX_SIDE) / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageRejectedError('Your browser cannot process photos here. Try a different browser.');
    // JPEG has no alpha — paint white first so transparent PNGs don't turn black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToJpeg(canvas, opts.quality ?? JPEG_QUALITY);
    if (blob.size === 0) throw new ImageRejectedError('That photo could not be processed. Try a different one.');
    const out = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
    prepared.add(out);
    return out;
  } finally {
    bitmap.close();
  }
}

export type PreparedSelection = { files: File[]; errors: string[] };

/** Prepares a multi-file selection independently — a bad file is reported, the good ones still go through. */
export async function prepareSelection(files: File[], opts: PrepareOptions = {}): Promise<PreparedSelection> {
  const results = await Promise.allSettled(files.map((f) => prepareImage(f, opts)));
  const out: PreparedSelection = { files: [], errors: [] };
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out.files.push(r.value);
    else out.errors.push(`${files[i].name}: ${r.reason instanceof ImageRejectedError ? r.reason.message : "couldn't be read as a photo."}`);
  });
  return out;
}
