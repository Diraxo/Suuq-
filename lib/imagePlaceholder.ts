// What a photo shows while its pixels download. Pure and unit-tested (tests/imageUrl.test.ts).
//
// Photos uploaded after migration 0073 carry a thumbhash (generated on the device at upload, stored in listings.image_hashes):
// decoded locally, so the blur appears on the first frame with no network. Older photos have none; where resizing is on they
// fall back to a ~32px version of the same photo, which is a few hundred bytes. Otherwise the caller's background colour shows.

import { imageResizeEnabled, imageUrl } from './imageUrl';

export type ImagePlaceholder = { thumbhash: string } | { uri: string } | undefined;

// A thumbhash is base64 of roughly 20-30 bytes. Anything else in the column is ignored, never passed to the native decoder.
const THUMBHASH = /^[A-Za-z0-9+/]{8,64}={0,2}$/;

export function isThumbhash(value: unknown): value is string {
  return typeof value === 'string' && THUMBHASH.test(value);
}

/** The stored hash for images[index], trusted only while the two arrays are the same length. */
export function hashAt(hashes: readonly string[] | undefined, imageCount: number, index: number): string | undefined {
  if (!hashes || hashes.length !== imageCount) return undefined;
  const hash = hashes[index];
  return isThumbhash(hash) ? hash : undefined;
}

export function imagePlaceholder(hash: string | undefined, url: string | undefined): ImagePlaceholder {
  if (hash && isThumbhash(hash)) return { thumbhash: hash };
  if (url && imageResizeEnabled()) return { uri: imageUrl(url, { size: 'tiny' }) };
  return undefined;
}
