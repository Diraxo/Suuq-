'use client';

// LEGACY FALLBACK ONLY. Photos published before the scan pipeline have no mark in their pixels; this draws the same
// repeating diagonal "Suuqiye" layout (lib/imageSafety.ts watermarkLayout) over the viewer so an ordinary screenshot of
// the page carries it. It is a deterrent, not protection: the file itself stays unmarked, and anyone can crop or
// paint over it. New photos arrive already watermarked (isWatermarkedDerivative) and never get this overlay — so
// nothing is marked twice. A photo counts as protected only once the pipeline has processed and verified it.
//
// The SVG's viewBox is the image's natural size and preserveAspectRatio matches the picture's object-fit, so the mark
// lines up with the photo (not the box) at any container size.
import { useMemo } from 'react';
import { isWatermarkedDerivative, watermarkLayout } from '@/lib/imageSafety';

type Props = {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  /** Must match the <Image> object-fit: 'cover' → slice, 'contain' → meet. */
  fit: 'cover' | 'contain';
};

export function WatermarkOverlay({ src, naturalWidth, naturalHeight, fit }: Props) {
  const layout = useMemo(() => (naturalWidth > 0 && naturalHeight > 0 ? watermarkLayout(naturalWidth, naturalHeight) : null), [naturalWidth, naturalHeight]);
  if (!layout || isWatermarkedDerivative(src)) return null;
  return (
    <svg
      aria-hidden
      focusable="false"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}
      preserveAspectRatio={fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
    >
      {/* Clip to the photo's own rectangle: with object-contain the SVG box is larger than the picture, and the
          rotated tiles would otherwise spill onto the black bars. */}
      <defs>
        <clipPath id="wm-photo-clip">
          <rect x={0} y={0} width={naturalWidth} height={naturalHeight} />
        </clipPath>
      </defs>
      <g clipPath="url(#wm-photo-clip)">
      <g transform={`translate(${naturalWidth / 2} ${naturalHeight / 2}) rotate(${layout.angle})`}>
        {layout.items.map((p, i) => (
          <g key={i}>
            <text x={p.x} y={p.y} fontSize={layout.fontSize} fontWeight={700} textAnchor="middle" fill="none" stroke="#000" strokeOpacity={layout.opacity * 0.6} strokeWidth={layout.fontSize * 0.09}>
              {layout.text}
            </text>
            <text x={p.x} y={p.y} fontSize={layout.fontSize} fontWeight={700} textAnchor="middle" fill="#fff" fillOpacity={layout.opacity}>
              {layout.text}
            </text>
          </g>
        ))}
      </g>
      </g>
    </svg>
  );
}
