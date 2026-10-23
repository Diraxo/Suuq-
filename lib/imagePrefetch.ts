import { Image } from 'expo-image';
import { imageUrl } from '@/lib/imageUrl';

/** Downloads these photos at carousel size into the memory + disk cache. Fire-and-forget: a failed prefetch is not an error. */
export function prefetchCardImages(urls: readonly (string | undefined)[]): void {
  const list = urls.filter((u): u is string => !!u).map((u) => imageUrl(u, { size: 'card' }));
  if (list.length === 0) return;
  Image.prefetch(list, 'memory-disk').catch(() => {});
}
