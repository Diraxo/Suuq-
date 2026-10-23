import { useEffect, useState } from 'react';
import { View, FlatList, Dimensions, Pressable } from 'react-native';
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
  const { listing, status } = useListing(id);
  const [active, setActive] = useState(indexParam(index, MAX_PHOTOS));
  const [zoomed, setZoomed] = useState(false);

  // Only leave once the server says the listing is not visible (never while it is still loading, or after a failed request).
  useEffect(() => {
    if (!listing && status === 'missing') router.back();
  }, [listing, status, router]);

  // Warm the cache with every photo at the viewer's size, so swiping to the next one paints (with its mark) at once.
  const images = listing?.images;
  useEffect(() => {
    if (images?.length) Image.prefetch(images.map((u) => imageUrl(u, { width: 1600 })), 'memory-disk').catch(() => {});
  }, [images]);

  if (!listing) return null;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" />
      {!zoomed && (
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

      <FlatList
        data={listing.images}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed}
        initialScrollIndex={Math.min(active, listing.images.length - 1)}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={(e) => setActive(Math.round(e.nativeEvent.contentOffset.x / width))}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item, index: i }) => (
          <ZoomableImage uri={item} isActive={i === active} onZoomChange={setZoomed} accessibilityLabel={t('listing.gallery.photoLabel')} />
        )}
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
