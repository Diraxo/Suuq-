import { useEffect, useState } from 'react';
import { View, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, useAnimatedReaction, withTiming, runOnJS } from 'react-native-reanimated';
import { imageUrl } from '@/lib/r2';

const { width, height } = Dimensions.get('window');
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

// expo-image's Image supports Reanimated's createAnimatedComponent natively (see its
// getAnimatableRef) â€” using it here instead of RN's core Animated.Image means every
// full-screen zoomable view shares expo-image's memory/disk cache with the rest of
// the app, so reopening a photo already shown elsewhere paints instantly instead of
// re-downloading it and flashing blank.
const AnimatedImage = Animated.createAnimatedComponent(Image);

/** Pinch/pan/double-tap zoomable full-bleed image â€” shared by the listing gallery
 *  (app/listing/gallery/[id].tsx) and the chat image viewer (components/chat/MessageImageViewer.tsx). */
export function ZoomableImage({
  uri,
  isActive,
  onZoomChange,
  accessibilityLabel = 'Photo, pinch or double-tap to zoom',
}: {
  uri: string;
  isActive: boolean;
  onZoomChange: (zoomed: boolean) => void;
  accessibilityLabel?: string;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedScale.value = 1;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  // Snapping back to page 1 (or navigating away) shouldn't leave an image stuck zoomed in.
  useEffect(() => {
    if (!isActive && (savedScale.value !== 1 || scale.value !== 1)) {
      reset();
    }
  }, [isActive]);

  useAnimatedReaction(
    () => scale.value > 1.01,
    (isZoomed, prev) => {
      if (isZoomed !== prev) runOnJS(setZoomed)(isZoomed);
    }
  );

  useEffect(() => {
    onZoomChange(zoomed);
  }, [zoomed]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = savedScale.value * e.scale;
      scale.value = Math.min(Math.max(next, 1), MAX_SCALE);
    })
    .onEnd(() => {
      if (scale.value <= 1) {
        reset();
      } else {
        savedScale.value = scale.value;
      }
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        reset();
      } else {
        scale.value = withTiming(DOUBLE_TAP_SCALE);
        savedScale.value = DOUBLE_TAP_SCALE;
      }
    });

  const gesture = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <AnimatedImage
          source={{ uri: imageUrl(uri, { width: 1600 }) }}
          accessibilityLabel={accessibilityLabel}
          style={[{ width, height: width }, animatedStyle]}
          contentFit="contain"
          cachePolicy="memory-disk"
          recyclingKey={uri}
          transition={200}
        />
      </View>
    </GestureDetector>
  );
}
