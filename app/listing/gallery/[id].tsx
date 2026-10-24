import { useEffect, useState } from 'react';
import { View, FlatList, Dimensions, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { idParam, indexParam } from '@/lib/routeParams';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { useListing } from '@/hooks/useListings';
import { Image } from 'expo-image';
import { imageUrl } from '@/lib/r2';
import { ZoomableImage } from '@/components/ZoomableImage';
import { Text } from '@/components/Text';
import { hashAt, imagePlaceholder } from '@/lib/imagePlaceholder';
import { imageTimingDone } from '@/lib/imageTiming';
import { VIEWER_WINDOW, viewerState } from '@/lib/viewerImage';

// A render error in this route shows a friendly retry screen instead of closing the app.
export { ErrorFallback as ErrorBoundary } from '@/components/ErrorFallback';

const { width } = Dimensions.get('window');
const MAX_PHOTOS = 8;

export default function ImageViewer() {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id: rawId, index } = useLocalSearchParams<{ id: string; index?: string }>();
  const id = idParam(rawId);
  const { listing, status, retry } = useListing(id);
  const [active, setActive] = useState(indexParam(index, MAX_PHOTOS));
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => { imageTimingDone('viewer: tap to mount'); }, []);

  // Only leave once the server says the listing is not visible (never while it is still loading, or after a failed request).
  useEffect(() => {
    if (!listing && status === 'missing') router.back();
  }, [listing, status, router]);

  // Warm the cache with the photos either side of the one on screen, so swiping to the next one paints (with its mark) at once.
  // Not every photo at once: eight parallel 1600px requests would queue the visible one behind its neighbours.
  const images = listing?.images;
  useEffect(() => {
    const near = images?.filter((_, i) => Math.abs(i - active) === 1);
    if (near?.length) Image.prefetch(near.map((u) => imageUrl(u, { width: 1600 })), 'memory-disk').catch(() => {});
  }, [images, active]);

  // The close button is drawn in every state (loading, failed, ready): it must never depend on the listing or a photo.
  const state = listing ? viewerState('ready') : viewerState(status);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" />
      {(!zoomed || !listing) && (
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('listing.gallery.close')}
          style={{ position: 'absolute', top: insets.top + 12, left: 16, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
      )}

      {state === 'loading' && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
          <ActivityIndicator size="small" color="#fff" />
        </View>
      )}

      {state === 'failed' && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 }}>
          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>{t('components.zoomableImage.loadFailed')}</Text>
          <Pressable
            onPress={retry}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
            style={{ minHeight: 44, minWidth: 120, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 20 }}
          >
            <Text variant="caption" style={{ color: '#fff' }}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      )}

      {listing && (
      <FlatList
        data={listing.images}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed}
        initialScrollIndex={Math.max(0, Math.min(active, listing.images.length - 1))}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        // Mount only the photo on screen and its neighbours: every ZoomableImage is a full-screen image with gestures and a watermark layer.
        initialNumToRender={VIEWER_WINDOW.initialNumToRender}
        maxToRenderPerBatch={VIEWER_WINDOW.maxToRenderPerBatch}
        windowSize={VIEWER_WINDOW.windowSize}
        onMomentumScrollEnd={(e) => setActive(Math.round(e.nativeEvent.contentOffset.x / width))}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item, index: i }) => (
          <ZoomableImage uri={item} placeholder={imagePlaceholder(hashAt(listing!.imageHashes, listing!.images.length, i), item)} isActive={i === active} onZoomChange={setZoomed} accessibilityLabel={t('listing.gallery.photoLabel')} />
        )}
      />
      )}

      {listing && !zoomed && (
        <View style={{ position: 'absolute', bottom: insets.bottom + 24, alignSelf: 'center', flexDirection: 'row', gap: 6 }}>
          {listing.images.map((_, i) => (
            <View key={i} style={{ width: i === active ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === active ? '#fff' : 'rgba(255,255,255,0.4)' }} />
          ))}
        </View>
      )}
    </View>
  );
}
