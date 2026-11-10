import React, { useEffect, useRef, useState } from 'react';
import { View, Dimensions, ActivityIndicator, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, useAnimatedReaction, withTiming, runOnJS } from 'react-native-reanimated';
import { imageUrl } from '@/lib/r2';
import { containRect, isWatermarkedDerivative } from '@/lib/imageSafety';
import { WatermarkOverlay } from '@/components/WatermarkOverlay';
import { DIAG_HIDE_WATERMARK } from '@/lib/diagFlags';
import { Text } from '@/components/Text';
import { useImageFallback } from '@/hooks/useImageFallback';
import { imageDiag, imageTimingDone, imageTimingSinceTap } from '@/lib/imageTiming';
import { knownImageSize, nextViewerImageStatus, redactImageUrl, rememberImageSize, viewerLayers, VIEWER_IMAGE_TIMEOUT_MS, VIEWER_SPINNER_DELAY_MS, type ViewerImageStatus } from '@/lib/viewerImage';

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
 *  (app/listing/gallery/[id].tsx). */
function ZoomableImageView({
  uri,
  isActive,
  onZoomChange,
  accessibilityLabel,
  placeholder,
  index,
}: {
  uri: string;
  /** Position in the gallery. Used only to label diagnostics. */
  index?: number;
  /** Placeholder (thumbhash or tiny uri) shown while neither preview nor full photo has arrived. */
  placeholder?: React.ComponentProps<typeof Image>['placeholder'];
  isActive: boolean;
  onZoomChange: (zoomed: boolean) => void;
  accessibilityLabel?: string;
}) {
  const { t } = useTranslation();
  const resolvedAccessibilityLabel = accessibilityLabel ?? t('components.zoomableImage.accessibilityLabel');
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);
  const [status, setStatus] = useState<ViewerImageStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  // The listing page (or an earlier opening) already loaded this photo and knows its size, so the mark can be drawn in the very first frame.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(() => knownImageSize(uri));
  // A resized variant that fails to load is retried once as the original (hooks/useImageFallback.ts) before the failed state shows.
  const full = useImageFallback(imageUrl(uri, { size: 'full' }));
  const resolvedUri = full.uri;
  // The listing page already showed (and cached) this photo at card size: paint it at once, under the full-resolution one.
  const previewFallback = useImageFallback(imageUrl(uri, { size: 'card' }));
  const previewUri = previewFallback.uri;
  const [previewReady, setPreviewReady] = useState(false);
  // `onLoad` means decoded, not painted. The preview stays under the full photo until the native view reports `onDisplay`, so there is
  // never a frame where the preview is gone and the full photo is not yet on screen (a black flash while React says 'loaded').
  // It is set one committed frame AFTER onDisplay (see onFullDisplay): still not a paint proof, but it removes the race where the
  // stand-in is dropped in the same JS turn the native view is merely handed the picture.
  const [fullDisplayed, setFullDisplayed] = useState(false);
  const frames = useRef<number[]>([]);
  const cancelFrames = () => {
    for (const f of frames.current) cancelAnimationFrame(f);
    frames.current = [];
  };
  // With resizing off (r2.dev host) the preview and full URLs are the same file: no second layer, the placeholder is the only early visual.
  const showPreview = !fullDisplayed && status !== 'error' && previewUri !== resolvedUri;
  const bakedWatermark = isWatermarkedDerivative(uri);
  const layers = viewerLayers({ status, hasSize: natural !== null, bakedWatermark, hasPlaceholder: !!placeholder, displayed: fullDisplayed });
  const diag = (event: string, fields?: Record<string, string | number | boolean | null | undefined>) => imageDiag(event, { idx: index, active: isActive, ...fields });

  // Dev-only: the mark and the photo are committed in the same render, so this is when both are on screen.
  useEffect(() => {
    if (isActive && layers.watermark) imageTimingDone('viewer: tap to watermark');
  }, [layers.watermark, isActive]);

  // Reset for a new request (retry or a different photo). Not on mount: state already starts as loading / no size, and a cached photo
  // can report onLoad before this passive effect flushes. React then runs the effect after that handler's updates were queued, so the
  // reset would overwrite them and leave the photo hidden (opacity 0) under a spinner with no further load event to recover it.
  const requestKey = useRef(`${resolvedUri}|${attempt}`);
  useEffect(() => {
    const key = `${resolvedUri}|${attempt}`;
    if (requestKey.current === key) return;
    requestKey.current = key;
    cancelFrames();
    setStatus((s) => nextViewerImageStatus(s, 'start'));
    setNatural(knownImageSize(uri));
    setFullDisplayed(false);
    setPreviewReady(false);
  }, [resolvedUri, attempt]);

  // Diagnostics: what is committed (a JS-side fact, not a paint), and the lifecycle of this photo's view.
  useEffect(() => {
    diag('photo view mounted', { variant: previewUri !== resolvedUri ? 'full-1600+card-preview' : 'full-1600', baked: bakedWatermark, sizeKnown: natural !== null, src: __DEV__ ? redactImageUrl(resolvedUri) : undefined });
    return () => {
      cancelFrames();
      diag('photo view unmounted');
    };
  }, []);
  useEffect(() => { diag('active index changed'); }, [isActive]);
  useEffect(() => { diag('photo layer committed', { opacity: layers.photo ? 1 : 0, status }); }, [layers.photo]);
  useEffect(() => { if (layers.watermark) diag('watermark layer committed', { photoOpacity: layers.photo ? 1 : 0 }); }, [layers.watermark]);
  useEffect(() => { if (fullDisplayed) diag('stand-in and preview removed'); }, [fullDisplayed]);

  // The spinner appears only for a photo that is still not on screen after a short delay: a cached photo never flashes one.
  const [spinnerOn, setSpinnerOn] = useState(false);
  const wantSpinner = status === 'loading' && !previewReady && !fullDisplayed;
  useEffect(() => {
    if (!wantSpinner) {
      setSpinnerOn(false);
      return;
    }
    const timer = setTimeout(() => setSpinnerOn(true), VIEWER_SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [wantSpinner, resolvedUri, attempt]);
  useEffect(() => { diag(spinnerOn ? 'spinner shown' : 'spinner hidden'); }, [spinnerOn]);

  const onFullDisplay = () => {
    if (isActive) imageTimingDone('viewer: tap to full photo displayed');
    diag('native display callback', { status });
    const token = requestKey.current;
    cancelFrames();
    // Two frames: the one the native view was given the picture in, and the next, which the compositor can have used.
    frames.current = [
      requestAnimationFrame(() => {
        frames.current = [
          requestAnimationFrame(() => {
            frames.current = [];
            if (requestKey.current === token) setFullDisplayed(true);
          }),
        ];
      }),
    ];
  };

  // Dev-only: what is committed for the active photo, to tell "loaded but hidden" apart from "never loaded".
  useEffect(() => {
    if (__DEV__ && isActive) console.log(`[img] viewer state: status=${status} size=${natural !== null} previewReady=${previewReady} photo=${layers.photo} spinner=${status === 'loading' && !previewReady}`);
  }, [isActive, status, natural, previewReady, layers.photo]);

  // A request that neither loads nor errors must not leave the spinner up forever.
  useEffect(() => {
    if (status !== 'loading') return;
    const timer = setTimeout(() => setStatus((s) => nextViewerImageStatus(s, 'timeout')), VIEWER_IMAGE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status, resolvedUri, attempt]);

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

  // A photo that fails or times out while zoomed returns to 1x, so the close button and paging come back.
  useEffect(() => {
    if (status === 'error' && (savedScale.value !== 1 || scale.value !== 1)) reset();
  }, [status]);

  useAnimatedReaction(
    () => scale.value > 1.01,
    (isZoomed, prev) => {
      if (isZoomed !== prev) runOnJS(setZoomed)(isZoomed);
    }
  );

  useEffect(() => {
    onZoomChange(zoomed);
  }, [zoomed]);

  // While the failed-photo panel (with its Retry button) is up, the photo gestures are off: a double-tap on Retry must press the
  // button, not zoom an empty photo and hide the close button.
  const gesturesOn = status !== 'error';

  const pinch = Gesture.Pinch()
    .enabled(gesturesOn)
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
    .enabled(zoomed && gesturesOn)
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .enabled(gesturesOn)
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
        {/* Image and watermark share ONE transformed layer, so zoom/pan can never separate them. */}
        {/* Blurred stand-in (thumbhash / tiny uri) while the real photo is hidden: it is not the photo, so it needs no mark. */}
        {layers.backdrop && !fullDisplayed && (
          <Image
            source={placeholder}
            style={{ position: 'absolute', width, height }}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
            pointerEvents="none"
            accessible={false}
            onDisplay={() => {
              if (isActive) imageTimingDone('viewer: tap to preview');
            }}
          />
        )}
        {/* Hidden until the photo's size is known, so the picture and its mark always appear in the same frame. The visibility gate is
            a plain View of its own: Reanimated drives the transform node inside it, and the two must not share a node. */}
        <View style={{ width, height, opacity: layers.photo ? 1 : 0 }}>
        <Animated.View style={[{ width, height }, animatedStyle]}>
          {showPreview && (
            <Image
              source={{ uri: previewUri }}
              placeholder={placeholder}
              style={{ position: 'absolute', width, height }}
              contentFit="contain"
              cachePolicy="memory-disk"
              priority="high"
              transition={0}
              onError={() => { previewFallback.onError(); }}
              onLoad={(e) => {
                previewFallback.onLoad();
                setPreviewReady(true);
                diag('preview loaded', { w: e?.source?.width, h: e?.source?.height, cache: e?.cacheType });
                rememberImageSize(uri, e?.source?.width, e?.source?.height);
                if (isActive) imageTimingDone('viewer: tap to preview');
                setNatural((n) => n ?? (e?.source?.width && e?.source?.height ? { w: e.source.width, h: e.source.height } : null));
              }}
            />
          )}
          <AnimatedImage
            key={attempt}
            source={{ uri: resolvedUri }}
            accessibilityLabel={resolvedAccessibilityLabel}
            style={{ width, height }}
            contentFit="contain"
            cachePolicy="memory-disk"
            priority={isActive ? 'high' : 'normal'}
            recyclingKey={uri}
            transition={previewReady && !fullDisplayed ? 120 : 0}
            // onLoad = bytes fetched and decoded by expo-image; onDisplay = the native view rendered them. The gap is decode/render time.
            onLoadStart={() => {
              if (isActive) imageTimingSinceTap('viewer: tap to full photo request started');
              diag('image request started');
            }}
            onLoad={(e) => {
              // cacheType is none | disk | memory: none = fetched from the network, i.e. the carousel's copy was not reused.
              full.onLoad();
              if (isActive) imageTimingDone('viewer: tap to full photo loaded', `cache: ${e?.cacheType}`);
              const w = e?.source?.width;
              const h = e?.source?.height;
              diag('image loaded', { w, h, cache: e?.cacheType });
              rememberImageSize(uri, w, h);
              if (w && h) setNatural((n) => (n && n.w === w && n.h === h ? n : { w, h }));
              // A photo that needs the overlay stays hidden until its size is known; without one it would be a blank screen, so fail visibly (with retry).
              setStatus((s) => nextViewerImageStatus(s, !bakedWatermark && !(w && h) ? 'error' : 'load'));
            }}
            onDisplay={onFullDisplay}
            onError={(e) => {
              // Never log the URL: it is the photo's address, and the message alone says what failed.
              if (full.onError()) {
                diag('image error, retrying as original');
                return;
              }
              if (__DEV__) console.error('[ZoomableImage] failed to load', e.error);
              diag('image error');
              setStatus((s) => nextViewerImageStatus(s, 'error'));
            }}
          />
          {/* Photos published by the scan Worker already carry the baked-in mark; only older photos get the overlay. */}
          {natural && layers.watermark && !DIAG_HIDE_WATERMARK && (() => {
            const r = containRect(natural.w, natural.h, width, height);
            return (
              <View pointerEvents="none" style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h }}>
                <WatermarkOverlay width={r.w} height={r.h} naturalWidth={natural.w} naturalHeight={natural.h} />
              </View>
            );
          })()}
        </Animated.View>
        </View>

        {spinnerOn && wantSpinner && (
          <View style={{ position: 'absolute' }} pointerEvents="none">
            <ActivityIndicator size="small" color="#fff" />
          </View>
        )}

        {status === 'error' && (
          <View style={{ position: 'absolute', alignItems: 'center', gap: 8, paddingHorizontal: 32 }}>
            <Ionicons name="image-outline" size={40} color="rgba(255,255,255,0.6)" />
            <Text variant="caption" style={{ color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
              {t('components.zoomableImage.loadFailed')}
            </Text>
            <Pressable
              onPress={() => setAttempt((n) => n + 1)}
              accessibilityRole="button"
              accessibilityLabel={t('common.retry')}
              hitSlop={8}
              style={{ minHeight: 44, minWidth: 120, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 20 }}
            >
              <Text variant="caption" style={{ color: '#fff' }}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

// Memoised: a swipe changes `isActive` on two photos only; the others (and their watermark layers) are not re-rendered.
export const ZoomableImage = React.memo(ZoomableImageView);
