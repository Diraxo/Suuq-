import { useEffect, useState } from 'react';
import { Modal, Pressable, View, Dimensions, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Props = {
  visible: boolean;
  uri: string;
  onClose: () => void;
};

// Minimal fullscreen "View Photo" viewer for the avatar menu — not the
// pinch-zoom gallery (app/listing/gallery/[id].tsx), just a plain fullscreen
// look at a single square photo. Mirrors ZoomableImage's loading/error
// handling and cachePolicy so a failed or slow load is never just a blank
// black screen.
export function AvatarViewerModal({ visible, uri, onClose }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    if (visible) setStatus('loading');
  }, [visible, uri]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}
      >
        <Image
          source={{ uri }}
          style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={150}
          onLoad={() => setStatus('loaded')}
          onError={(e) => {
            if (__DEV__) console.error('[AvatarViewerModal] failed to load', uri, e.error);
            setStatus('error');
          }}
        />

        {status === 'loading' && (
          <View style={{ position: 'absolute' }} pointerEvents="none">
            <ActivityIndicator size="small" color="#fff" />
          </View>
        )}

        {status === 'error' && (
          <View style={{ position: 'absolute', alignItems: 'center', gap: 8, paddingHorizontal: 32 }} pointerEvents="none">
            <Ionicons name="image-outline" size={40} color="rgba(255,255,255,0.6)" />
            <Text variant="caption" style={{ color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
              {t('components.zoomableImage.loadFailed')}
            </Text>
          </View>
        )}

        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('components.avatarViewer.closePhoto')}
          style={{ position: 'absolute', top: insets.top + 12, right: 16, padding: 8 }}
        >
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
