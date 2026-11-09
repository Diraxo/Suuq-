import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { G, Text as SvgText } from 'react-native-svg';
import { WATERMARK_TEXT } from '@/lib/imageSafety';

// Light look, same as the website: a sparse low-opacity diagonal mark plus one clear corner mark so the product stays
// the subject. Pure vector drawing over an already-loaded photo — no extra download, no spinner, nothing waits on it.
const ANGLE = -30;
const OPACITY = 0.2;
const CORNER_OPACITY = 0.45;

function lightLayout(width: number, height: number) {
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

/** Repeating diagonal "Suuqiye" mark drawn over the picture itself (not the screen), from the same layout
 *  the scan Worker bakes into published photos — so an ordinary screenshot of the viewer carries it. It is
 *  a deterrent, not protection: a determined person can crop or paint over it. Sized in the image's own
 *  coordinate space and scaled to the displayed rectangle, so zoom/pan (applied by the parent layer) can
 *  never misalign it. */
export const WatermarkOverlay = memo(function WatermarkOverlay({ width, height, naturalWidth, naturalHeight }: { width: number; height: number; naturalWidth: number; naturalHeight: number }) {
  const layout = useMemo(() => lightLayout(naturalWidth, naturalHeight), [naturalWidth, naturalHeight]);
  if (!(width > 0 && height > 0 && naturalWidth > 0 && naturalHeight > 0)) return null;
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 0, top: 0, width, height, overflow: 'hidden' }}>
      <Svg width={width} height={height} viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}>
        <G transform={`translate(${naturalWidth / 2} ${naturalHeight / 2}) rotate(${ANGLE})`}>
          {layout.items.map((p, i) => (
            <G key={i}>
              {/* dark halo first so the white mark reads on light photos too */}
              <SvgText x={p.x} y={p.y} fontSize={layout.fontSize} fontWeight="700" textAnchor="middle" fill="none" stroke="#000" strokeOpacity={OPACITY * 0.6} strokeWidth={layout.fontSize * 0.09}>
                {WATERMARK_TEXT}
              </SvgText>
              <SvgText x={p.x} y={p.y} fontSize={layout.fontSize} fontWeight="700" textAnchor="middle" fill="#fff" fillOpacity={OPACITY}>
                {WATERMARK_TEXT}
              </SvgText>
            </G>
          ))}
        </G>
        <G>
          <SvgText x={naturalWidth - layout.margin} y={naturalHeight - layout.margin} fontSize={layout.cornerSize} fontWeight="700" textAnchor="end" fill="none" stroke="#000" strokeOpacity={CORNER_OPACITY * 0.6} strokeWidth={layout.cornerSize * 0.09}>
            {WATERMARK_TEXT}
          </SvgText>
          <SvgText x={naturalWidth - layout.margin} y={naturalHeight - layout.margin} fontSize={layout.cornerSize} fontWeight="700" textAnchor="end" fill="#fff" fillOpacity={CORNER_OPACITY}>
            {WATERMARK_TEXT}
          </SvgText>
        </G>
      </Svg>
    </View>
  );
});
