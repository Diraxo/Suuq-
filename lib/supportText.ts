import i18n from '@/lib/i18n';
import { translateText } from '@/lib/textKeys';

/** Support-flow messages are English sentences in the shared lib/supportApi.ts; this shows them in the active language. */
export const tx = (english: string): string => translateText((key, options) => String(i18n.t(key, options as never)), english);
