import { useCallback, useState } from 'react';
import type { ImagePickerAsset } from 'expo-image-picker';
import { validateImageAsset, ImageValidationOptions } from '@/lib/imageValidation';
import { resizeAndCompress } from '@/lib/imagePipeline';
import { uploadToR2, UploadedImage } from '@/lib/r2';
import { showSnackbar } from '@/lib/snackbar';
import i18n from '@/lib/i18n';

// The one reusable upload pipeline: validate -> compress/resize -> upload to
// R2. Every image upload site in the app (listing photos, avatar, business
// logo/banner, review/chat images) should call this instead of hand-rolling
// its own pick/validate/upload logic.
export function useImageUpload(folder: string, options: ImageValidationOptions = {}) {
  const [uploading, setUploading] = useState(false);
  const { skipMinDimension } = options;

  const upload = useCallback(
    async (asset: ImagePickerAsset): Promise<UploadedImage | null> => {
      const validation = validateImageAsset(asset, { skipMinDimension });
      if (!validation.ok) {
        showSnackbar(validation.message);
        return null;
      }
      setUploading(true);
      try {
        const localUri = await resizeAndCompress(asset.uri);
        return await uploadToR2(localUri, folder);
      } catch (err: any) {
        showSnackbar(err?.message ?? i18n.t('errors.uploadFailedFallback'));
        return null;
      } finally {
        setUploading(false);
      }
    },
    [folder, skipMinDimension]
  );

  return { upload, uploading };
}
