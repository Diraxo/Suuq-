import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const MAX_DIMENSION = 1280;
const COMPRESS_QUALITY = 0.7;

export type PrepareOptions = {
  /** width / height. The picture is centre-cropped to this shape first, so the stored image is always the shape the screen shows. */
  aspect?: number;
  maxSide?: number;
  quality?: number;
};

// Profile pictures are shown small, so they are kept small on purpose: an avatar/logo ends up around 30-60 KB and a banner around 100-200 KB.
export const PROFILE_IMAGE_PRESETS = {
  avatar: { aspect: 1, maxSide: 512, quality: 0.8 },
  logo: { aspect: 1, maxSide: 512, quality: 0.8 },
  banner: { aspect: 16 / 9, maxSide: 1600, quality: 0.75 },
} satisfies Record<string, PrepareOptions>;

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

// The one resize/compress step shared by every upload site (hooks/useImageUpload.ts
// for avatar/business/review images, lib/storage.ts for listing photos):
// optionally centre-crops to a fixed shape, caps the longest side (1280px by
// default) — never upscales, never stretched or distorted — then compresses to
// a JPEG. R2 has no on-the-fly delivery transform (unlike Cloudinary), so this
// upload-time resize/compress is the only size/quality optimization images
// get — see lib/r2.ts's imageUrl() for the (legacy-only) exception.
export async function resizeAndCompress(uri: string, options: PrepareOptions = {}): Promise<string> {
  const { width, height } = await getImageSize(uri);
  const maxSide = options.maxSide ?? MAX_DIMENSION;
  const context = ImageManipulator.manipulate(uri);
  let outW = width;
  let outH = height;
  if (options.aspect && width > 0 && height > 0 && Math.abs(width / height - options.aspect) > 0.01) {
    // Tiny rounding differences are left alone; anything else is cropped to the wanted shape around the centre.
    if (width / height > options.aspect) outW = Math.round(height * options.aspect);
    else outH = Math.round(width / options.aspect);
    context.crop({ originX: Math.floor((width - outW) / 2), originY: Math.floor((height - outH) / 2), width: outW, height: outH });
  }
  if (outW > maxSide || outH > maxSide) {
    if (outW >= outH) context.resize({ width: maxSide });
    else context.resize({ height: maxSide });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: options.quality ?? COMPRESS_QUALITY, format: SaveFormat.JPEG });
  return saved.uri;
}
