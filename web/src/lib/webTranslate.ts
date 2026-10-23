import en from './webText/en';
import so from './webText/so';
import am from './webText/am';
import type { Translate } from './sellText';

// The website's t(): the same strings as the mobile app (locales/*), for the
// language chosen in the language store. No React or store imports, so it is
// testable in node. A missing entry falls back to English, then to the English
// defaultValue passed by the caller, and never shows a raw key.
export type WebLocale = 'en' | 'so' | 'am';
export type Dictionary = Record<string, unknown>;

/** t(key, values) plus t.text("English sentence"): for labels kept as English constants (menus, statuses, weekdays, legal text). */
export type WebTranslate = Translate & { text: (english: string) => string };

export const DICTIONARIES: Record<WebLocale, Dictionary> = { en, so, am };

const lookup = (dict: Dictionary | undefined, key: string): string | undefined => {
  let node: unknown = dict;
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  return typeof node === 'string' ? node : undefined;
};

const normalize = (s: string) =>
  s
    .replace(/&apos;|&#39;|&rsquo;|[’‘]/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// English sentence -> locale key, built once from the English dictionary.
let englishIndex: Map<string, string> | undefined;
function keyForEnglish(english: string): string | undefined {
  if (!englishIndex) {
    englishIndex = new Map();
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        if (!node.includes('{{')) {
          const n = normalize(node);
          if (!englishIndex!.has(n)) englishIndex!.set(n, path);
        }
      } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(en, '');
  }
  return englishIndex.get(normalize(english));
}

export function makeT(dict: Dictionary | undefined, fallback: Dictionary = en): WebTranslate {
  const t = ((key: string, options: Record<string, unknown> = {}) => {
    // i18next-style plurals: time.minutesAgo -> time.minutesAgo_one / _other
    const plural = typeof options.count === 'number' ? (options.count === 1 ? '_one' : '_other') : '';
    const raw = lookup(dict, key + plural) ?? lookup(dict, key) ?? lookup(fallback, key + plural) ?? lookup(fallback, key) ?? (options.defaultValue as string | undefined) ?? key;
    return raw.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name] ?? ''));
  }) as WebTranslate;
  t.text = (english) => {
    const key = keyForEnglish(english);
    return key ? t(key, { defaultValue: english }) : english;
  };
  return t;
}

/** Back-compat for the Sell flow's helpers and tests: a translator for one language. */
export const makeSellT = (locale: WebLocale): WebTranslate => makeT(DICTIONARIES[locale]);
