'use client';

import { useState } from 'react';

// Round avatar for admin screens. A plain <img> on purpose: avatar_url can point at any host (Google, R2, legacy
// Cloudinary) and the reviewer must still see something when the image is gone - initials replace a broken image.
export function AdminAvatar({ name, url, size = 36 }: { name: string; url: string | null | undefined; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = (name || '?').trim().slice(0, 1).toUpperCase();
  const style = { width: size, height: size };
  if (!url || broken) {
    return (
      <span style={style} className="flex shrink-0 items-center justify-center rounded-full bg-inputBackground text-xs font-semibold text-textSecondary" aria-hidden>
        {initials}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" style={style} className="shrink-0 rounded-full object-cover" loading="lazy" onError={() => setBroken(true)} />
  );
}
