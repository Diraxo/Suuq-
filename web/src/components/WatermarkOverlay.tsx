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
import { isWatermarkedDerivative, WATERMARK_TEXT } from '@/lib/imageSafety';

// Website look: a light, sparse diagonal mark plus one clear corner mark, so the product stays the subject.
// This is pure SVG drawn after the photo has loaded, so it adds no network request and never delays the image.
const WEB_ANGLE = -30;
const WEB_OPACITY = 0.2;
const CORNER_OPACITY = 0.45;

function webLayout(width: number, height: number) {
  const base = Math.min(width, height);
  const fontSize = Math.max(14, Math.round(base * 0.04));
  const stepX = Math.round(fontSize * 11);
  const stepY = Math.round(fontSize * 9);
  const reach = Math.ceil(Math.hypot(width, height) / 2);
  const items: { x: number; y: number }[] = [];
  let row = 0;
  for (let y = -reach; y <= reach; y += stepY, row++) {
    const offset = row % 2 ? stepX / 2 : 0;
    for (let x = -reach + offset; x <= reach; x += stepX) items.push({ x: Math.round(x), y: Math.round(y) });
  }
  return { fontSize, items, cornerSize: Math.max(16, Math.round(base * 0.05)), margin: Math.round(base * 0.035) };
}

type Props = {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  /** Must match the <Image> object-fit: 'cover' → slice, 'contain' → meet. */
  fit: 'cover' | 'contain';
};

export function WatermarkOverlay({ src, naturalWidth, naturalHeight, fit }: Props) {
  const layout = useMemo(() => (naturalWidth > 0 && naturalHeight > 0 ? webLayout(naturalWidth, naturalHeight) : null), [naturalWidth, naturalHeight]);
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
      <g transform={`translate(${naturalWidth / 2} ${naturalHeight / 2}) rotate(${WEB_ANGLE})`}>
        {layout.items.map((p, i) => (
          <g key={i}>
            <text x={p.x} y={p.y} fontSize={layout.fontSize} fontWeight={700} textAnchor="middle" fill="none" stroke="#000" strokeOpacity={WEB_OPACITY * 0.6} strokeWidth={layout.fontSize * 0.09}>
              {WATERMARK_TEXT}
            </text>
            <text x={p.x} y={p.y} fontSize={layout.fontSize} fontWeight={700} textAnchor="middle" fill="#fff" fillOpacity={WEB_OPACITY}>
              {WATERMARK_TEXT}
            </text>
          </g>
        ))}
      </g>
      <g>
        <text x={naturalWidth - layout.margin} y={naturalHeight - layout.margin} fontSize={layout.cornerSize} fontWeight={700} textAnchor="end" fill="none" stroke="#000" strokeOpacity={CORNER_OPACITY * 0.6} strokeWidth={layout.cornerSize * 0.09}>
          {WATERMARK_TEXT}
        </text>
        <text x={naturalWidth - layout.margin} y={naturalHeight - layout.margin} fontSize={layout.cornerSize} fontWeight={700} textAnchor="end" fill="#fff" fillOpacity={CORNER_OPACITY}>
          {WATERMARK_TEXT}
        </text>
      </g>
      </g>
    </svg>
  );
}
