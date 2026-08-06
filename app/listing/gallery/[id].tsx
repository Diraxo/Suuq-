import { useEffect, useState } from 'react';
import { View, FlatList, Dimensions, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, useAnimatedReaction, withTiming, runOnJS } from 'react-native-reanimated';
import { mockListings } from '@/data/mockListings';
import { useListingsStore, resolveListing } from '@/store/listings';
import { cldUrl } from '@/lib/cloudinary';

const { width, height } = Dimensions.get('window');
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

// expo-image's Image supports Reanimated's createAnimatedComponent natively (see its
// getAnimatableRef) — using it here instead of RN's core Animated.Image means the
// full-screen viewer shares expo-image's memory/disk cache with the rest of the app,
// so reopening a photo that was already shown in the hero/thumbnail strip paints
// instantly instead of re-downloading it and flashing blank.
const AnimatedImage = Animated.createAnimatedComponent(Image);

function ZoomableImage({ uri, isActive, onZoomChange }: { uri: string; isActive: boolean; onZoomChange: (zoomed: boolean) => void }) {
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
          source={{ uri: cldUrl(uri, { width: 1600 }) }}
          accessibilityLabel="Listing photo, pinch or double-tap to zoom"
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

export default function ImageViewer() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, index } = useLocalSearchParams<{ id: string; index?: string }>();
  const allListings = useListingsStore((s) => s.listings);
  const listing = resolveListing(id, allListings) ?? mockListings[0];
  const [active, setActive] = useState(Number(index ?? 0));
  const [zoomed, setZoomed] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" />
      {!zoomed && (
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close gallery"
          style={{ position: 'absolute', top: insets.top + 12, left: 16, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
      )}

      <FlatList
        data={listing.images}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed}
        initialScrollIndex={active}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={(e) => setActive(Math.round(e.nativeEvent.contentOffset.x / width))}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item, index: i }) => <ZoomableImage uri={item} isActive={i === active} onZoomChange={setZoomed} />}
      />

      {!zoomed && (
        <View style={{ position: 'absolute', bottom: insets.bottom + 24, alignSelf: 'center', flexDirection: 'row', gap: 6 }}>
          {listing.images.map((_, i) => (
            <View key={i} style={{ width: i === active ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === active ? '#fff' : 'rgba(255,255,255,0.4)' }} />
          ))}
        </View>
      )}
    </View>
  );
}
