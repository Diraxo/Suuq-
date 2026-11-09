'use client';

// A photo that stays invisible until it has fully loaded and decoded, then fades in over the skeleton box behind it.
// Without this the browser paints a downloading JPEG from the top down (half picture, half grey). Cached photos
// (complete before React attached onLoad) are caught by the ref callback and show at once.
import { useCallback, useState } from 'react';
import Image, { type ImageProps } from 'next/image';

type Props = Omit<ImageProps, 'onLoad' | 'onError'> & { onFailed?: () => void };

export function FadeImage({ className, style, onFailed, src, ...rest }: Props) {
  const [loaded, setLoaded] = useState<unknown>(null);
  const done = loaded === src;
  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth > 0) setLoaded(src);
    },
    [src],
  );
  return (
    <Image
      {...rest}
      ref={ref}
      src={src}
      decoding="async"
      className={className}
      style={{ ...style, opacity: done ? 1 : 0, transition: 'opacity 180ms ease-out' }}
      onLoad={(e) => {
        const img = e.currentTarget;
        const finish = () => setLoaded(src);
        // decode() resolves once the pixels are ready to paint, so the fade never reveals a half-drawn picture.
        if (typeof img.decode === 'function') img.decode().then(finish, finish);
        else finish();
      }}
      onError={() => onFailed?.()}
    />
  );
}
