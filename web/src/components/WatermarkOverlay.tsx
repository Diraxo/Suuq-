'use client';

// LEGACY FALLBACK ONLY. Photos published before the scan pipeline have no mark in their pixels; this draws a light,
// repeating diagonal "Suuqiye" mark ON THE PHOTO so an ordinary screenshot of the page carries it. It is a deterrent, not
// protection: the file itself stays unmarked. New photos arrive already watermarked (isWatermarkedDerivative) and never get
// this overlay, so nothing is marked twice.
//
// The mark never leaves the picture:
//  - fit 'cover' (the listing hero): the photo fills its box, so the mark fills the box. Sized in CSS pixels, it needs nothing
//    from the photo and is in the very first frame.
//  - fit 'contain' (the full-screen viewer): the photo leaves black bars, so the mark is laid on the photo's own rectangle
//    (viewBox = the photo's size, meet-fitted like the picture) and nothing is drawn on the bars. `size` comes from the
//    page's earlier load of the photo, so this is also instant; without it nothing is drawn (the caller holds the photo back).
import { useId } from 'react';
import { isWatermarkedDerivative, WATERMARK_TEXT } from '@/lib/imageSafety';

const ANGLE = -30;
const OPACITY = 0.2;
const CORNER_OPACITY = 0.45;

type Props = {
  src: string;
  fit: 'cover' | 'contain';
  size: { w: number; h: number } | null;
};

export function WatermarkOverlay({ src, fit, size }: Props) {
  const id = `wm-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (isWatermarkedDerivative(src)) return null;
  if (fit === 'contain' && !(size && size.w > 0 && size.h > 0)) return null;

  // Everything below is in the SVG's own user units: CSS pixels for the box, the photo's pixels for the viewBox.
  const w = fit === 'contain' && size ? size.w : 0;
  const h = fit === 'contain' && size ? size.h : 0;
  const base = fit === 'contain' ? Math.min(w, h) : 0;
  const font = fit === 'contain' ? Math.max(14, Math.round(base * 0.04)) : 16;
  const tileW = fit === 'contain' ? Math.round(font * 11) : 176;
  const tileH = fit === 'contain' ? Math.round(font * 9) : 144;
  const cornerFont = fit === 'contain' ? Math.max(16, Math.round(base * 0.05)) : 20;
  const inset = fit === 'contain' ? Math.round(base * 0.035) : 12;

  const halo = { fill: 'none', stroke: '#000', strokeOpacity: OPACITY * 0.6, strokeWidth: font * 0.09 } as const;
  const cornerHalo = { fill: 'none', stroke: '#000', strokeOpacity: CORNER_OPACITY * 0.6, strokeWidth: cornerFont * 0.09 } as const;
  // Two marks per tile, staggered, so the repeat reads as a diagonal lattice.
  const spots = [
    { x: tileW * 0.25, y: tileH * 0.25 },
    { x: tileW * 0.75, y: tileH * 0.75 },
  ];
  // Box mode anchors the corner mark to the box's bottom-right with percentages; photo mode uses the photo's own corner.
  const cornerX = fit === 'contain' ? w - inset : '100%';
  const cornerY = fit === 'contain' ? h - inset : '100%';
  const cornerDx = fit === 'contain' ? 0 : -inset;
  const cornerDy = fit === 'contain' ? 0 : -inset;

  return (
    <svg
      aria-hidden
      focusable="false"
      className="pointer-events-none absolute inset-0 h-full w-full select-none"
      width="100%"
      height="100%"
      {...(fit === 'contain' ? { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'xMidYMid meet' } : {})}
    >
      <defs>
        <pattern id={id} width={tileW} height={tileH} patternUnits="userSpaceOnUse" patternTransform={`rotate(${ANGLE})`}>
          {spots.map((p, i) => (
            <g key={i}>
              <text x={p.x} y={p.y} fontSize={font} fontWeight={700} textAnchor="middle" {...halo}>{WATERMARK_TEXT}</text>
              <text x={p.x} y={p.y} fontSize={font} fontWeight={700} textAnchor="middle" fill="#fff" fillOpacity={OPACITY}>{WATERMARK_TEXT}</text>
            </g>
          ))}
        </pattern>
      </defs>
      {/* In photo mode this rectangle IS the photo, so the pattern stops at its edges and the bars stay clean. */}
      <rect width={fit === 'contain' ? w : '100%'} height={fit === 'contain' ? h : '100%'} fill={`url(#${id})`} />
      <text x={cornerX} y={cornerY} dx={cornerDx} dy={cornerDy} fontSize={cornerFont} fontWeight={700} textAnchor="end" {...cornerHalo}>{WATERMARK_TEXT}</text>
      <text x={cornerX} y={cornerY} dx={cornerDx} dy={cornerDy} fontSize={cornerFont} fontWeight={700} textAnchor="end" fill="#fff" fillOpacity={CORNER_OPACITY}>{WATERMARK_TEXT}</text>
    </svg>
  );
}
