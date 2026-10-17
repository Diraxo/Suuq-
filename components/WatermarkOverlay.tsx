import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { G, Text as SvgText } from 'react-native-svg';
import { watermarkLayout } from '@/lib/imageSafety';

/** Repeating diagonal "Suuqiye" mark drawn over the picture itself (not the screen), from the same layout
 *  the scan Worker bakes into published photos — so an ordinary screenshot of the viewer carries it. It is
 *  a deterrent, not protection: a determined person can crop or paint over it. Sized in the image's own
 *  coordinate space and scaled to the displayed rectangle, so zoom/pan (applied by the parent layer) can
 *  never misalign it. */
export const WatermarkOverlay = memo(function WatermarkOverlay({ width, height, naturalWidth, naturalHeight }: { width: number; height: number; naturalWidth: number; naturalHeight: number }) {
  const layout = useMemo(() => watermarkLayout(naturalWidth, naturalHeight), [naturalWidth, naturalHeight]);
  if (!(width > 0 && height > 0 && naturalWidth > 0 && naturalHeight > 0)) return null;
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 0, top: 0, width, height, overflow: 'hidden' }}>
      <Svg width={width} height={height} viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}>
        <G transform={`translate(${naturalWidth / 2} ${naturalHeight / 2}) rotate(${layout.angle})`}>
          {layout.items.map((p, i) => (
            <G key={i}>
              {/* dark halo first so the white mark reads on light photos too */}
              <SvgText x={p.x} y={p.y} fontSize={layout.fontSize} fontWeight="700" textAnchor="middle" fill="none" stroke="#000" strokeOpacity={layout.opacity * 0.6} strokeWidth={layout.fontSize * 0.09}>
                {layout.text}
              </SvgText>
              <SvgText x={p.x} y={p.y} fontSize={layout.fontSize} fontWeight="700" textAnchor="middle" fill="#fff" fillOpacity={layout.opacity}>
                {layout.text}
              </SvgText>
            </G>
          ))}
        </G>
      </Svg>
    </View>
  );
});
