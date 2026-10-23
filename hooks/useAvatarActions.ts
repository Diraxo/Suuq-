import { useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { launchCameraAsync, launchImageLibraryAsync } from '@/lib/imagePickerSafe';
import { useAuthStore } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { deleteR2Assets } from '@/lib/r2';
import { PROFILE_IMAGE_PRESETS } from '@/lib/imagePipeline';
import { useImageUpload } from '@/hooks/useImageUpload';
import { showSnackbar } from '@/lib/snackbar';
import { interpretWrite } from '@/lib/saveOutcome';
import i18n from '@/lib/i18n';

// Shared "tap the avatar" flow (Change / Remove / View) used by both the
// Profile tab and Edit Profile — avatars skip the 480px minimum-dimension
// check (see lib/imageValidation.ts) since they're a small cropped square,
// not a listing photo.
export function useAvatarActions() {
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const { upload, uploading } = useImageUpload(`avatars/${session?.user.id ?? 'unknown'}`, { skipMinDimension: true, prepare: PROFILE_IMAGE_PRESETS.avatar });
  const [viewerVisible, setViewerVisible] = useState(false);

  const launchPicker = async (source: 'camera' | 'library') => {
    const permission =
      source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        i18n.t('avatar.permissionNeededTitle'),
        source === 'camera' ? i18n.t('avatar.cameraPermissionMessage') : i18n.t('avatar.libraryPermissionMessage')
      );
      return;
    }
    const result =
      source === 'camera'
        ? await launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.9 })
        : await launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    if (result.canceled || result.assets.length === 0 || !session) return;

    const uploaded = await upload(result.assets[0]);
    if (!uploaded) return;

    // Captured before the DB write so cleanup targets the asset this upload
    // replaces, never the brand-new one that was just saved. Null for
    // pre-migration rows (an old Cloudinary avatar) — those are simply left
    // in place, since there's no Cloudinary credential left to delete them with.
    const previousPublicId = profile?.avatar_public_id ?? null;

    const written = interpretWrite(await supabase.from('profiles').update({ avatar_url: uploaded.url, avatar_public_id: uploaded.publicId }).eq('id', session.user.id).select('id'));
    if (!written.ok) {
      showSnackbar(i18n.t('errors.avatarUpdateFailed'));
      return;
    }
    await refreshProfile();
    showSnackbar(i18n.t('avatar.updated'));

    if (previousPublicId && previousPublicId !== uploaded.publicId) {
      deleteR2Assets([previousPublicId]);
    }
  };

  const removePhoto = async () => {
    if (!session) return;
    const previousPublicId = profile?.avatar_public_id ?? null;
    const removed = interpretWrite(await supabase.from('profiles').update({ avatar_url: null, avatar_public_id: null }).eq('id', session.user.id).select('id'));
    if (!removed.ok) {
      showSnackbar(i18n.t('errors.avatarRemoveFailed'));
      return;
    }
    await refreshProfile();
    showSnackbar(i18n.t('avatar.removed'));
    if (previousPublicId) deleteR2Assets([previousPublicId]);
  };

  const confirmRemove = () => {
    Alert.alert(i18n.t('avatar.removeConfirmTitle'), undefined, [
      { text: i18n.t('common.cancel'), style: 'cancel' },
      { text: i18n.t('common.remove'), style: 'destructive', onPress: removePhoto },
    ]);
  };

  const openAvatarMenu = () => {
    const hasPhoto = !!profile?.avatar_url;
    Alert.alert(i18n.t('avatar.menuTitle'), undefined, [
      { text: i18n.t('avatar.changePhoto'), onPress: () => launchPicker('library') },
      { text: i18n.t('avatar.takePhoto'), onPress: () => launchPicker('camera') },
      ...(hasPhoto ? [{ text: i18n.t('avatar.viewPhoto'), onPress: () => setViewerVisible(true) }] : []),
      ...(hasPhoto ? [{ text: i18n.t('avatar.removePhoto'), style: 'destructive' as const, onPress: confirmRemove }] : []),
      { text: i18n.t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  return { openAvatarMenu, openViewer: () => setViewerVisible(true), uploading, viewerVisible, closeViewer: () => setViewerVisible(false) };
}
