import { useCallback, useState } from 'react';
import type { ImagePickerAsset } from 'expo-image-picker';
import { validateImageAsset, ImageValidationOptions } from '@/lib/imageValidation';
import { resizeAndCompress, PrepareOptions } from '@/lib/imagePipeline';
import { uploadToR2, UploadedImage } from '@/lib/r2';
import { showSnackbar } from '@/lib/snackbar';
import { BusinessMediaError } from '@/lib/businessMedia';
import i18n from '@/lib/i18n';

// The one reusable upload pipeline: validate -> compress/resize -> upload to
// R2. Every image upload site in the app (listing photos, avatar, business
// logo/banner, review/chat images) should call this instead of hand-rolling
// its own pick/validate/upload logic.
export function useImageUpload(folder: string, options: ImageValidationOptions & { prepare?: PrepareOptions } = {}) {
  const [uploading, setUploading] = useState(false);
  const { skipMinDimension } = options;
  const aspect = options.prepare?.aspect;
  const maxSide = options.prepare?.maxSide;
  const quality = options.prepare?.quality;

  const upload = useCallback(
    async (asset: ImagePickerAsset): Promise<UploadedImage | null> => {
      const validation = validateImageAsset(asset, { skipMinDimension });
      if (!validation.ok) {
        showSnackbar(validation.message);
        return null;
      }
      setUploading(true);
      try {
        const localUri = await resizeAndCompress(asset.uri, { aspect, maxSide, quality });
        return await uploadToR2(localUri, folder);
      } catch (err: any) {
        // Business logo/banner failures carry a code so the message can be shown in the user's language.
        showSnackbar(err instanceof BusinessMediaError ? i18n.t(`errors.businessMedia.${err.code}`, { defaultValue: err.message }) : err?.message ?? i18n.t('errors.uploadFailedFallback'));
        return null;
      } finally {
        setUploading(false);
      }
    },
    [folder, skipMinDimension, aspect, maxSide, quality]
  );

  return { upload, uploading };
}
