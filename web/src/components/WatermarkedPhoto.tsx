'use client';

// A photo and its watermark as ONE unit. The photo stays invisible until its natural size is known, then the photo
// and the mark fade in together — so a viewer never sees the bare picture first and the mark seconds later. Mount it
// with key={src} (or let the key below do it) so every photo change starts from a fresh, hidden state.
import { useCallback, useState } from 'react';
import Image from 'next/image';
import { isWatermarkedDerivative } from '@/lib/imageSafety';
import { WatermarkOverlay } from '@/components/WatermarkOverlay';

type Props = {
  src: string;
  alt: string;
  fit: 'cover' | 'contain';
  sizes: string;
  priority?: boolean;
};

export function WatermarkedPhoto({ src, alt, fit, sizes, priority }: Props) {
  const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null);
  const needsOverlay = !isWatermarkedDerivative(src);
  const ready = !needsOverlay || natural?.src === src;

  // A ref callback also catches photos already in the browser cache, whose load event fired before React attached onLoad.
  const measure = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth > 0) setNatural((n) => (n?.src === src ? n : { src, w: img.naturalWidth, h: img.naturalHeight }));
    },
    [src],
  );

  return (
    <div key={src} className="absolute inset-0" style={{ opacity: ready ? 1 : 0, transition: 'opacity 120ms ease-out' }}>
      <Image
        ref={measure}
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        className={fit === 'cover' ? 'object-cover' : 'object-contain'}
        onLoad={(e) => {
          const img = e.currentTarget;
          setNatural({ src, w: img.naturalWidth, h: img.naturalHeight });
        }}
      />
      {needsOverlay && natural?.src === src && <WatermarkOverlay src={src} naturalWidth={natural.w} naturalHeight={natural.h} fit={fit} />}
    </div>
  );
}
