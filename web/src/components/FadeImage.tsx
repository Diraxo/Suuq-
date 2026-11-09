'use client';

// A photo that stays invisible until it has fully loaded and decoded, then fades in over the skeleton box behind it.
// Without this the browser paints a downloading JPEG from the top down (half picture, half grey). Cached photos
// (complete before React attached onLoad) are caught by the ref callback and show at once.
import { useCallback, useEffect, useRef, useState } from 'react';
import Image, { type ImageProps } from 'next/image';

type Props = Omit<ImageProps, 'onLoad' | 'onError'> & { onFailed?: () => void; onRecovered?: () => void };

// A photo that fails is retried on its own (1.5s, 3s, 6s), and once more the moment the connection comes back,
// so a weak network never leaves a card permanently blank. Only after the automatic retries run out is onFailed called.
const RETRY_DELAYS_MS = [1500, 3000, 6000];

export function FadeImage({ className, style, onFailed, onRecovered, src, ...rest }: Props) {
  const [loaded, setLoaded] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);
  const failedRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // New photo: start fresh.
    setAttempt(0);
    setGaveUp(false);
    failedRef.current = false;
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [src]);
  useEffect(() => {
    if (!gaveUp) return;
    const retryNow = () => {
      setGaveUp(false);
      setAttempt((n) => n + 1);
    };
    window.addEventListener('online', retryNow);
    return () => window.removeEventListener('online', retryNow);
  }, [gaveUp]);
  const done = loaded === src;
  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth > 0) setLoaded(src);
    },
    [src],
  );
  return (
    <Image
      key={attempt}
      {...rest}
      ref={ref}
      src={src}
      decoding="async"
      className={className}
      style={{ ...style, opacity: done ? 1 : 0, transition: 'opacity 180ms ease-out' }}
      onLoad={(e) => {
        const img = e.currentTarget;
        const finish = () => {
          setLoaded(src);
          if (failedRef.current) {
            failedRef.current = false;
            onRecovered?.();
          }
        };
        // decode() resolves once the pixels are ready to paint, so the fade never reveals a half-drawn picture.
        if (typeof img.decode === 'function') img.decode().then(finish, finish);
        else finish();
      }}
      onError={() => {
        if (attempt < RETRY_DELAYS_MS.length) {
          timer.current = setTimeout(() => setAttempt((n) => n + 1), RETRY_DELAYS_MS[attempt]);
        } else {
          failedRef.current = true;
          setGaveUp(true);
          onFailed?.();
        }
      }}
    />
  );
}
