import { useEffect, useState } from 'react';
import { Modal, Pressable, View, useWindowDimensions, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';

// expo-screen-capture is a native module: a build made before it was added does not have it, so it is loaded defensively and the
// viewer still works (without the capture block) rather than crashing the profile screen.
type ScreenCaptureModule = { preventScreenCaptureAsync: (key?: string) => Promise<void>; allowScreenCaptureAsync: (key?: string) => Promise<void> };
let ScreenCapture: ScreenCaptureModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ScreenCapture = require('expo-screen-capture');
} catch {
  ScreenCapture = null;
}

const CAPTURE_KEY = 'business-media-viewer';

type Props = { visible: boolean; uri: string; kind: 'banner' | 'logo'; onClose: () => void };

// Full-screen look at a business banner or logo. Deliberately has no save, share or download control, and while it is open the OS is
// asked to block screenshots and screen recording (Android: always blocked; iOS: recording and screenshots show blank). This protects
// only this full-screen view: the small banner/logo on the profile page itself are ordinary screen content.
export function BusinessMediaViewer({ visible, uri, kind, onClose }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    if (visible) setStatus('loading');
  }, [visible, uri]);

  useEffect(() => {
    if (!visible || !ScreenCapture) return;
    ScreenCapture.preventScreenCaptureAsync(CAPTURE_KEY).catch(() => {});
    return () => {
      ScreenCapture?.allowScreenCaptureAsync(CAPTURE_KEY).catch(() => {});
    };
  }, [visible]);

  const size = kind === 'logo' ? { width: width - 32, height: width - 32, borderRadius: (width - 32) / 2 } : { width, height: Math.min(height * 0.7, width * 1.2) };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <Image
          source={{ uri }}
          style={size}
          contentFit={kind === 'logo' ? 'cover' : 'contain'}
          cachePolicy="memory-disk"
          transition={150}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
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
