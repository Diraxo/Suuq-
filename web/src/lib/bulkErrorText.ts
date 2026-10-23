import { localizeSellError } from './sellText';
import type { WebTranslate } from './webTranslate';

// Row problems from lib/bulkUpload.ts are English sentences (shared with the CSV rules); this shows them in the chosen language.
export function bulkErrorText(t: WebTranslate, message: string): string {
  const value = (v: string) => (v === '(blank)' ? t('bulkUpload.blank') : v);
  let m = /^Unknown category "(.*)"\.$/.exec(message);
  if (m) return t('bulkUpload.unknownCategory', { category: value(m[1]) });
  m = /^Unknown condition "(.*)"\. Use new, like-new, used, or for-parts\.$/.exec(message);
  if (m) return t('bulkUpload.unknownCondition', { condition: value(m[1]) });
  m = /^Unknown city "(.*)"\.$/.exec(message);
  if (m) return t('bulkUpload.unknownCity', { city: value(m[1]) });
  if (message.startsWith('At least one image URL is required')) return t('bulkUpload.imageUrlRequired');
  return localizeSellError(t, message) ?? message;
}
