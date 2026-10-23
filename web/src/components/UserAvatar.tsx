'use client';

import { useEffect, useState } from 'react';

// A person's photo, or the first letter of their name on a plain circle when they have none (or it fails to load). Placeholder photos
// (picsum) and the sign-in provider's photo are never shown as someone's face. Same look as the mobile app's UserAvatar.
export function UserAvatar({ url, name, size = 84, className = '' }: { url: string | null | undefined; name: string; size?: number; className?: string }) {
  const real = url && !url.includes('picsum.photos') ? url : null;
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [real]);
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
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={real} alt={name} style={style} className={`shrink-0 rounded-full object-cover ${className}`} onError={() => setBroken(true)} />
  );
}
