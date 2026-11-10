'use client';

// LEGACY FALLBACK ONLY. Photos published before the scan pipeline have no mark in their pixels; this draws a light,
// repeating diagonal "Suuqiye" mark over the photo's box so an ordinary screenshot of the page carries it. It is a
// deterrent, not protection: the file itself stays unmarked. New photos arrive already watermarked
// (isWatermarkedDerivative) and never get this overlay, so nothing is marked twice.
//
// The mark is an SVG pattern sized in CSS pixels. It needs nothing from the photo (no natural size, no load event), so it
// is in the very first frame the box is drawn — before the picture arrives and for as long as it is on screen — and it
// never moves, resizes or fades in late. It fills the box whatever the photo's aspect ratio, so there is no layout to
// recompute and nothing that can fail.
import { useId } from 'react';
import { isWatermarkedDerivative, WATERMARK_TEXT } from '@/lib/imageSafety';

const FONT = 16;
const TILE_W = 176;
const TILE_H = 144;
const ANGLE = -30;
const OPACITY = 0.2;
const CORNER_OPACITY = 0.45;
const CORNER_FONT = 20;
const CORNER_INSET = 12;

export function WatermarkOverlay({ src }: { src: string }) {
  const id = `wm-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (isWatermarkedDerivative(src)) return null;
  const halo = { fill: 'none', stroke: '#000', strokeOpacity: OPACITY * 0.6, strokeWidth: FONT * 0.09 } as const;
  const cornerHalo = { fill: 'none', stroke: '#000', strokeOpacity: CORNER_OPACITY * 0.6, strokeWidth: CORNER_FONT * 0.09 } as const;
  // Two marks per tile, staggered, so the repeat reads as a diagonal lattice.
  const spots = [
    { x: TILE_W * 0.25, y: TILE_H * 0.25 },
    { x: TILE_W * 0.75, y: TILE_H * 0.75 },
  ];
  return (
    <svg aria-hidden focusable="false" className="pointer-events-none absolute inset-0 h-full w-full select-none" width="100%" height="100%">
      <defs>
        <pattern id={id} width={TILE_W} height={TILE_H} patternUnits="userSpaceOnUse" patternTransform={`rotate(${ANGLE})`}>
          {spots.map((p, i) => (
            <g key={i}>
              <text x={p.x} y={p.y} fontSize={FONT} fontWeight={700} textAnchor="middle" {...halo}>{WATERMARK_TEXT}</text>
              <text x={p.x} y={p.y} fontSize={FONT} fontWeight={700} textAnchor="middle" fill="#fff" fillOpacity={OPACITY}>{WATERMARK_TEXT}</text>
            </g>
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
      <text x="100%" y="100%" dx={-CORNER_INSET} dy={-CORNER_INSET} fontSize={CORNER_FONT} fontWeight={700} textAnchor="end" {...cornerHalo}>{WATERMARK_TEXT}</text>
      <text x="100%" y="100%" dx={-CORNER_INSET} dy={-CORNER_INSET} fontSize={CORNER_FONT} fontWeight={700} textAnchor="end" fill="#fff" fillOpacity={CORNER_OPACITY}>{WATERMARK_TEXT}</text>
    </svg>
  );
}
