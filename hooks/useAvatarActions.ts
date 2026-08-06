import { useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { extractPublicId, deleteCloudinaryAssets } from '@/lib/cloudinary';
import { useImageUpload } from '@/hooks/useImageUpload';
import { showSnackbar } from '@/lib/snackbar';

// Shared "tap the avatar" flow (Change / Remove / View) used by both the
// Profile tab and Edit Profile — avatars skip the 480px minimum-dimension
// check (see lib/imageValidation.ts) since they're a small cropped square,
// not a listing photo.
export function useAvatarActions() {
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const { upload, uploading } = useImageUpload(`suuqplus/avatars/${session?.user.id ?? 'unknown'}`, { skipMinDimension: true });
  const [viewerVisible, setViewerVisible] = useState(false);

  const launchPicker = async (source: 'camera' | 'library') => {
    const permission =
      source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', source === 'camera' ? 'Allow camera access in Settings to take a photo.' : 'Allow photo access in Settings to choose a photo.');
      return;
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    if (result.canceled || result.assets.length === 0 || !session) return;

    const uploaded = await upload(result.assets[0]);
    if (!uploaded) return;

    // Captured before the DB write so cleanup targets the asset this upload
    // replaces, never the brand-new one that was just saved.
    const previousPublicId = profile?.avatar_public_id || (profile?.avatar_url ? extractPublicId(profile.avatar_url) : null);

    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: uploaded.url, avatar_public_id: uploaded.publicId })
      .eq('id', session.user.id);
    if (error) {
      showSnackbar('Could not update your profile photo. Try again.');
      return;
    }
    await refreshProfile();
    showSnackbar('Profile photo updated.');

    if (previousPublicId && previousPublicId !== uploaded.publicId) {
      deleteCloudinaryAssets([previousPublicId]);
    }
  };

  const removePhoto = async () => {
    if (!session) return;
    const previousPublicId = profile?.avatar_public_id || (profile?.avatar_url ? extractPublicId(profile.avatar_url) : null);
    const { error } = await supabase.from('profiles').update({ avatar_url: null, avatar_public_id: null }).eq('id', session.user.id);
    if (error) {
      showSnackbar('Could not remove your profile photo. Try again.');
      return;
    }
    await refreshProfile();
    showSnackbar('Profile photo removed.');
    if (previousPublicId) deleteCloudinaryAssets([previousPublicId]);
  };

  const confirmRemove = () => {
    Alert.alert('Remove profile photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: removePhoto },
    ]);
  };

  const openAvatarMenu = () => {
    const hasPhoto = !!profile?.avatar_url;
    Alert.alert('Profile photo', undefined, [
      { text: 'Change Photo', onPress: () => launchPicker('library') },
      { text: 'Take Photo', onPress: () => launchPicker('camera') },
      ...(hasPhoto ? [{ text: 'View Photo', onPress: () => setViewerVisible(true) }] : []),
      ...(hasPhoto ? [{ text: 'Remove Photo', style: 'destructive' as const, onPress: confirmRemove }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  return { openAvatarMenu, uploading, viewerVisible, closeViewer: () => setViewerVisible(false) };
}
