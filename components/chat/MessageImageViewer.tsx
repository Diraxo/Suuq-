import { useState } from 'react';
import { Modal, View, FlatList, Dimensions, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { ZoomableImage } from '@/components/ZoomableImage';

const { width } = Dimensions.get('window');

type Props = {
  images: string[];
  initialIndex: number;
  onClose: () => void;
};

/** Fullscreen tap-to-zoom viewer for message images — same ZoomableImage engine
 *  as the listing gallery, wrapped in AvatarViewerModal's simpler Modal-shell
 *  chrome (backdrop + close button) since there's no route to push here. */
export function MessageImageViewer({ images, initialIndex, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [active, setActive] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);

  return (
    <Modal visible={images.length > 0} transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <StatusBar style="light" />
        {!zoomed && (
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('chat.closePhoto')}
            style={{
              position: 'absolute',
              top: insets.top + 12,
              left: 16,
              zIndex: 10,
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: 'rgba(255,255,255,0.15)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="close" size={20} color="#fff" />
          </Pressable>
        )}

        <FlatList
          data={images}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          initialScrollIndex={active}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => setActive(Math.round(e.nativeEvent.contentOffset.x / width))}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item, index: i }) => (
            <ZoomableImage uri={item} isActive={i === active} onZoomChange={setZoomed} accessibilityLabel={t('chat.zoomPhotoHint')} />
          )}
        />

        {!zoomed && images.length > 1 && (
          <View style={{ position: 'absolute', bottom: insets.bottom + 24, alignSelf: 'center', flexDirection: 'row', gap: 6 }}>
            {images.map((_, i) => (
              <View key={i} style={{ width: i === active ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === active ? '#fff' : 'rgba(255,255,255,0.4)' }} />
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
}
