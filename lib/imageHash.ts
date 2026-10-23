import { Image } from 'expo-image';
import { isThumbhash } from '@/lib/imagePlaceholder';

// Cap on how long the blur hash may delay an upload; a photo without one still uploads and simply shows the card background.
const HASH_TIMEOUT_MS = 4000;

/** Thumbhash of a local (already resized) photo, or undefined when it cannot be made in time. Never throws. */
export async function thumbhashOf(localUri: string): Promise<string | undefined> {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), HASH_TIMEOUT_MS);
    });
    const hash = await Promise.race([Image.generateThumbhashAsync(localUri), timeout]);
    if (timer) clearTimeout(timer);
    return isThumbhash(hash) ? hash : undefined;
  } catch {
    return undefined;
  }
}
