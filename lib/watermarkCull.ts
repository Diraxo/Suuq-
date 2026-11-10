// Draws only the mark tiles that can land inside the picture. Pure (tested in tests/watermarkCull.test.ts).
//
// watermarkLayout() lays tiles over the picture's whole rotated bounding square, so the Worker's baked-in copy and the app's
// overlay agree. About 60% of those tiles fall outside the picture once rotated, where the overlay's clip hides them anyway, but
// react-native-svg still builds and draws each one (two stroked/filled text nodes apiece) on the UI thread when the viewer opens.
// Dropping the invisible ones changes no pixel and removes most of that work. watermarkLayout itself is untouched.

import type { watermarkLayout } from '@/lib/imageSafety';

type Layout = ReturnType<typeof watermarkLayout>;

// Generous per-glyph advance for a 700-weight sans face, in em. Over-estimating only keeps a few more tiles, never drops a visible one.
const GLYPH_ADVANCE_EM = 0.75;

export function visibleWatermarkItems(layout: Layout, width: number, height: number): Layout['items'] {
  if (!(width > 0 && height > 0)) return layout.items;
  const rad = (layout.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Half the text's width plus the halo and ascent/descent, as a margin on every side of the picture.
  const margin = layout.fontSize * (layout.text.length * GLYPH_ADVANCE_EM * 0.5 + 1.2);
  const cx = width / 2;
  const cy = height / 2;
  return layout.items.filter((p) => {
    const x = cx + p.x * cos - p.y * sin;
    const y = cy + p.x * sin + p.y * cos;
    return x >= -margin && x <= width + margin && y >= -margin && y <= height + margin;
  });
}
