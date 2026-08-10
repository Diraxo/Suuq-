import * as ImagePicker from 'expo-image-picker';

const UNREGISTERED_LAUNCHER_PATTERN = /unregistered ActivityResultLauncher/i;

// On a cold app start, expo-image-picker's native Activity-Result launcher
// can still be finishing registration on the (possibly just-recreated)
// Activity when the very first pick is triggered, throwing "Attempting to
// launch an unregistered ActivityResultLauncher" (Android-only, seen on
// physical devices, not reproducible once the app is warm). One retry after
// a short delay is enough since the registration always wins that race
// well within a few hundred ms.
async function withLauncherRetry<T>(launch: () => Promise<T>): Promise<T> {
  try {
    return await launch();
  } catch (err: any) {
    if (!UNREGISTERED_LAUNCHER_PATTERN.test(err?.message ?? '')) throw err;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return await launch();
  }
}

export function launchImageLibraryAsync(
  options?: ImagePicker.ImagePickerOptions
): Promise<ImagePicker.ImagePickerResult> {
  return withLauncherRetry(() => ImagePicker.launchImageLibraryAsync(options));
}

export function launchCameraAsync(
  options?: ImagePicker.ImagePickerOptions
): Promise<ImagePicker.ImagePickerResult> {
  return withLauncherRetry(() => ImagePicker.launchCameraAsync(options));
}
