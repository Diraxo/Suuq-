import { useCallback, useState } from 'react';
import { imageOriginalUrl, reportResizeFailure } from '@/lib/imageUrl';

/**
 * Safe source for one resized photo URL. If the resized variant fails to load, the next render uses the original it was built from
 * (once); `onError` returns true when it did that (the caller should NOT show its failed state yet). `onLoad` confirms the
 * transformation was the problem (the variant failed and the original loaded) and tells the session circuit breaker in lib/imageUrl.ts.
 * The fallback is remembered per variant URL, so a different URL starts fresh.
 */
export function useImageFallback(resolved: string): { uri: string; usedFallback: boolean; onError: () => boolean; onLoad: () => void } {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const original = imageOriginalUrl(resolved);
  const usedFallback = failedUri === resolved && !!original;
  const onError = useCallback(() => {
    if (!original || failedUri === resolved) return false;
    setFailedUri(resolved);
    return true;
  }, [original, failedUri, resolved]);
  const onLoad = useCallback(() => {
    if (usedFallback) reportResizeFailure();
  }, [usedFallback]);
  return { uri: usedFallback ? (original as string) : resolved, usedFallback, onError, onLoad };
}
