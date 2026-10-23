'use client';

import type { ReactNode } from 'react';
import { Store } from 'lucide-react';
import type { ProfileMode } from '@/lib/profileIdentity';

// Text always sits on the card below the banner, so it uses the normal theme colours. `ring` separates an avatar that overlaps the banner.
export type CoverClasses = { primary: string; secondary: string; ring: string };

type Props = {
  mode: ProfileMode;
  /** Business banner. Only drawn in business mode; with none, a default gradient is used. */
  bannerUrl?: string | null;
  className?: string;
  children: (c: CoverClasses) => ReactNode;
};

// The one profile header (avatar, name, bio) for both modes. Personal mode is a plain header. Business mode puts a banner panel at the top and
// the same avatar straddles its bottom edge (half on the banner, half below), with the name and details underneath on the card.
export function ProfileHeaderCover({ mode, bannerUrl, className = '', children }: Props) {
  const banner = mode === 'business';
  const c: CoverClasses = { primary: 'text-textPrimary', secondary: 'text-textSecondary', ring: banner ? 'ring-4 ring-surface' : '' };
  if (!banner) {
    return <div className={`relative flex w-full flex-col items-center px-4 py-6 ${className}`}>{children(c)}</div>;
  }
  return (
    <div className={`w-full overflow-hidden rounded-3xl border border-border bg-surface pb-4 ${className}`}>
      <div aria-hidden className="relative aspect-[2/1] w-full bg-gradient-to-br from-primary to-indigo-900 sm:aspect-[5/2] md:aspect-[3/1]">
        {bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bannerUrl} alt="" draggable={false} onContextMenu={(e) => e.preventDefault()} className="h-full w-full object-cover" />
        ) : (
          <Store size={72} className="absolute right-3 top-3 text-white/15" />
        )}
        {/* Fades any banner (a bright one especially) into the card so the avatar ring and the edge sit cleanly. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-b from-transparent to-surface" />
      </div>
      {/* Half of the avatar (84-88px) rides on the banner, the other half hangs below it. */}
      <div className="-mt-11 flex flex-col items-center px-4">{children(c)}</div>
    </div>
  );
}
