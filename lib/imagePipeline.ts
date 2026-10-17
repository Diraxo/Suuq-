import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const MAX_DIMENSION = 1280;
const COMPRESS_QUALITY = 0.7;

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

// The one resize/compress step shared by every upload site (hooks/useImageUpload.ts
// for avatar/business/review images, lib/storage.ts for listing photos):
// caps the longest side at 1280px — never upscales, aspect ratio preserved,
// never stretched or distorted — then compresses to ~70%-quality JPEG. R2
// has no on-the-fly delivery transform (unlike Cloudinary), so this
// upload-time resize/compress is the only size/quality optimization images
// get — see lib/r2.ts's imageUrl() for the (legacy-only) exception.
export async function resizeAndCompress(uri: string): Promise<string> {
  const { width, height } = await getImageSize(uri);
  const context = ImageManipulator.manipulate(uri);
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    if (width >= height) context.resize({ width: MAX_DIMENSION });
    else context.resize({ height: MAX_DIMENSION });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: COMPRESS_QUALITY, format: SaveFormat.JPEG });
  return saved.uri;
}
