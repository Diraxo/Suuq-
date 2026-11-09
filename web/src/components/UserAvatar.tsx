'use client';

import { useCallback, useEffect, useState } from 'react';

// A person's photo, or the first letter of their name on a plain circle when they have none (or it fails to load). Placeholder photos
// (picsum) and the sign-in provider's photo are never shown as someone's face. Same look as the mobile app's UserAvatar.
export function UserAvatar({ url, name, size = 84, className = '' }: { url: string | null | undefined; name: string; size?: number; className?: string }) {
  const real = url && !url.includes('picsum.photos') ? url : null;
  const [broken, setBroken] = useState(false);
  // Hidden until fully loaded and decoded: otherwise the browser paints a downloading JPEG from the top down (half picture, half empty).
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => setBroken(false), [real]);
  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth > 0) setLoaded(real);
    },
    [real],
  );
  const style = { width: size, height: size };
  if (!real || broken) {
    return (
      <span
        style={{ ...style, fontSize: size * 0.42 }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-inputBackground font-semibold text-textSecondary ${className}`}
        role="img"
        aria-label={name}
      >
        {(name || '?').trim().slice(0, 1).toUpperCase()}
      </span>
    );
  }
  const shown = loaded === real;
  return (
    <span style={style} className={`relative inline-flex shrink-0 rounded-full ${className}`}>
      {!shown && (
        <span
          style={{ ...style, fontSize: size * 0.42 }}
          className="absolute inset-0 flex items-center justify-center rounded-full bg-inputBackground font-semibold text-textSecondary"
          aria-hidden
        >
          {(name || '?').trim().slice(0, 1).toUpperCase()}
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={ref}
        src={real}
        alt={name}
        style={{ ...style, opacity: shown ? 1 : 0, transition: 'opacity 180ms ease-out' }}
        className="rounded-full object-cover"
        decoding="async"
        fetchPriority="high"
        onLoad={(e) => {
          const img = e.currentTarget;
          const finish = () => setLoaded(real);
          if (typeof img.decode === 'function') img.decode().then(finish, finish);
          else finish();
        }}
        onError={() => setBroken(true)}
      />
    </span>
  );
}
