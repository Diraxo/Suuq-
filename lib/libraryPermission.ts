import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

// Android uses the system photo picker, which needs no storage/media permission
// (and READ_MEDIA_IMAGES is blocked in app.json). iOS still asks as before.
export const requestLibraryPermission = async (): Promise<{ granted: boolean }> =>
  Platform.OS === 'android' ? { granted: true } : ImagePicker.requestMediaLibraryPermissionsAsync();
