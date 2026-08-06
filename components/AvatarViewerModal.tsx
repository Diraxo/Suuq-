import { Modal, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  uri: string;
  onClose: () => void;
};

// Minimal fullscreen "View Photo" viewer for the avatar menu — not the
// pinch-zoom gallery (app/listing/gallery/[id].tsx), just a plain fullscreen
// look at a single square photo.
export function AvatarViewerModal({ visible, uri, onClose }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}
      >
        <Image source={{ uri }} style={{ width: '100%', aspectRatio: 1 }} contentFit="contain" transition={150} />
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          style={{ position: 'absolute', top: insets.top + 12, right: 16, padding: 8 }}
        >
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
