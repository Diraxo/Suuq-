'use client';

import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useLanguageStore, type AppLocale } from '@/store/language';
import en from './webText/en';
import { makeT, type Dictionary, type WebTranslate } from './webTranslate';

// English ships with the page; Somali and Amharic are fetched the first time
// they are needed, so visitors on English never download them.
const loaders: Record<Exclude<AppLocale, 'en'>, () => Promise<{ default: Dictionary }>> = {
  so: () => import('./webText/so'),
  am: () => import('./webText/am'),
};

const useDictionaries = create<{ loaded: Partial<Record<AppLocale, Dictionary>>; set: (l: AppLocale, d: Dictionary) => void }>((set) => ({
  loaded: { en },
  set: (locale, dict) => set((s) => ({ loaded: { ...s.loaded, [locale]: dict } })),
}));

/** Mounted once in the root layout: loads the chosen language's text. */
export function useLoadWebText() {
  const locale = useLanguageStore((s) => s.locale);
  const set = useDictionaries((s) => s.set);
  useEffect(() => {
    if (locale === 'en' || useDictionaries.getState().loaded[locale]) return;
    void loaders[locale]().then((m) => set(locale, m.default));
  }, [locale, set]);
}

/** t() for any website page: same keys as the mobile app (locales/*), in the language chosen in the language store. */
export function useT(): WebTranslate {
  const locale = useLanguageStore((s) => s.locale);
  const dict = useDictionaries((s) => s.loaded[locale]);
  return useMemo(() => makeT(dict ?? en), [dict]);
}

/** t() for code that is not a React component (services, formatters): reads the chosen language at call time. */
export function getT(): WebTranslate {
  const locale = useLanguageStore.getState().locale;
  return makeT(useDictionaries.getState().loaded[locale] ?? en);
}

type ScanCopy = typeof import('./imageScanCopy').IMAGE_SCAN_COPY;

const deepMerge = (base: unknown, over: unknown): unknown => {
  if (!over || typeof over !== 'object' || !base || typeof base !== 'object') return over ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = deepMerge(out[k], v);
  return out;
};

/** The photo-check dialog's wording (locales imageScan.*) in the chosen language, English where a line is missing. */
export function useScanCopy(): ScanCopy {
  const locale = useLanguageStore((s) => s.locale);
  const dict = useDictionaries((s) => s.loaded[locale]);
  return useMemo(() => deepMerge(en.imageScan, dict?.imageScan) as ScanCopy, [dict]);
}

/** BCP-47 tag of the chosen language ('en' | 'so' | 'am') for Intl / toLocale*String, so month names follow the app language. */
export const localeTag = (): string => useLanguageStore.getState().locale;
