import { getT } from '@/lib/i18n';

/** Support-flow messages are English sentences in the shared lib/supportApi.ts; this shows them in the chosen language. */
export const tx = (english: string): string => getT().text(english);
