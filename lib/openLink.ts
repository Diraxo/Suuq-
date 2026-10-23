import { Linking } from 'react-native';
import i18n from '@/lib/i18n';
import { showSnackbar } from '@/lib/snackbar';
import { isSafeExternalUrl } from '@/lib/safeUrl';

/** Opens a web page, phone dialler or mail app. Refuses anything that is not http(s)/tel/mailto, and says so kindly (no mail app, no dialler, tablet...) instead of throwing. */
export async function openExternal(url: string): Promise<boolean> {
  try {
    if (!isSafeExternalUrl(url)) throw new Error('blocked url scheme');
    await Linking.openURL(url);
    return true;
  } catch {
    showSnackbar(i18n.t('errors.cannotOpenLink'));
    return false;
  }
}
