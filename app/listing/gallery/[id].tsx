import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Dimensions, Pressable, ActivityIndicator } from 'react-native';
// The gesture-handler list, not core RN's: every photo carries pinch / double-tap gestures, and a pager built on a different
// gesture system than those gestures can refuse a swipe (the same arbitration issue app/listing/[id].tsx documents).
import { FlatList } from 'react-native-gesture-handler';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { idParam, indexParam } from '@/lib/routeParams';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { useListing } from '@/hooks/useListings';
import { cancelGalleryPrefetch, prefetchGalleryPhotos } from '@/lib/imagePrefetch';
import { ZoomableImage } from '@/components/ZoomableImage';
import { Text } from '@/components/Text';
import { hashAt, imagePlaceholder } from '@/lib/imagePlaceholder';
import { imageDiag, imageTimingDone } from '@/lib/imageTiming';
import { VIEWER_WINDOW, viewerCellBuilt, viewerState } from '@/lib/viewerImage';

// A render error in this route shows a friendly retry screen instead of closing the app.
export { ErrorFallback as ErrorBoundary } from '@/components/ErrorFallback';

const { width, height } = Dimensions.get('window');
const ignoreZoom = () => {};
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

  useEffect(() => {
    imageTimingDone('viewer: tap to mount');
    imageDiag('viewer mounted', { index: active });
    return () => imageDiag('viewer unmounted');
  }, []);
  useEffect(() => { imageDiag('viewer index changed', { index: active }); }, [active]);
  useEffect(() => { if (listing) imageDiag('listing ready', { photos: listing.images.length }); }, [!!listing]);

  // Only leave once the server says the listing is not visible (never while it is still loading, or after a failed request).
  useEffect(() => {
    if (!listing && status === 'missing') router.back();
  }, [listing, status, router]);

  // Prepare this listing's photos at the exact size shown here: the one on screen first, then its neighbours, then the rest, a couple at
  // a time (never all eight at once, which would queue the visible one behind them). Photos the listing page already requested are skipped.
  const images = listing?.images;
  // Started after the swipe has settled: the downloads and decodes this triggers must not compete with the scroll animation.
  useEffect(() => {
    if (!images?.length) return;
    const timer = setTimeout(() => prefetchGalleryPhotos(images, active, { opened: true }), 300);
    return () => clearTimeout(timer);
  }, [images, active]);
  // Closing the viewer withdraws what it still had queued (downloads already started finish into the cache).
  useEffect(() => cancelGalleryPrefetch, []);

  // Stable per-photo inputs, so a swipe (which changes `active`) re-renders only the photos whose `isActive` flips, not every photo.
  const placeholders = useMemo(() => (listing ? listing.images.map((uri, i) => imagePlaceholder(hashAt(listing.imageHashes, listing.images.length, i), uri)) : []), [listing?.images, listing?.imageHashes]);
  const photoLabel = t('listing.gallery.photoLabel');
  // The open photo is built first; its neighbours are built one beat later, once it has had the screen to itself.
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWarm(true), 250);
    return () => clearTimeout(timer);
  }, []);
  const renderPhoto = useCallback(
    ({ item, index: i }: { item: string; index: number }) =>
      viewerCellBuilt(i, active, warm) ? (
        // Only the open photo reports zoom: a neighbour built later must not flip the pager back on while the open one is zoomed.
        <ZoomableImage uri={item} index={i} placeholder={placeholders[i]} isActive={i === active} onZoomChange={i === active ? setZoomed : ignoreZoom} accessibilityLabel={photoLabel} />
      ) : (
        <View style={{ width, height }} />
      ),
    [placeholders, active, warm, photoLabel]
  );
  // A swipe only ever happens while no photo is zoomed, so a settled page is never zoomed: clearing the flag here means the pager
  // can never stay locked by a zoom report that arrived late or from a photo that is no longer the open one.
  const onSettled = useCallback((e: { nativeEvent: { contentOffset: { x: number } } }) => {
    setActive(Math.round(e.nativeEvent.contentOffset.x / width));
    setZoomed(false);
  }, []);

  // The close button is drawn in every state (loading, failed, ready, zoomed): it must never depend on the listing, a photo or zoom.
  const state = listing ? viewerState('ready') : viewerState(status);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" />
      <Pressable
        onPress={() => router.back()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('listing.gallery.close')}
        style={{ position: 'absolute', top: insets.top + 12, left: 16, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name="close" size={20} color="#fff" />
      </Pressable>

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
        // One cell per photo stays mounted (an empty shell unless the photo is near the open one, see viewerCellBuilt), so scrolling never mounts a cell.
        initialNumToRender={listing.images.length}
        maxToRenderPerBatch={listing.images.length}
        windowSize={VIEWER_WINDOW.windowSize}
        onMomentumScrollEnd={onSettled}
        keyExtractor={(_, i) => String(i)}
        extraData={active}
        renderItem={renderPhoto}
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
