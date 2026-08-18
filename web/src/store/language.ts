'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppLocale = 'en' | 'so' | 'am';

// Matches lib/i18n.ts on mobile — each language's own native name, never
// translated.
export const LANGUAGE_NAMES: Record<AppLocale, string> = {
  en: 'English',
  so: 'Soomaali',
  am: 'አማርኛ',
};
export const SUPPORTED_LOCALES: AppLocale[] = ['en', 'so', 'am'];

type LanguageState = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
};

// Single-select, exactly like store/language.ts on mobile: choosing a new
// locale always replaces the previous one, never adds to it.
export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      locale: 'en',
      setLocale: (locale) => set({ locale }),
    }),
    { name: 'fursad-web-language' }
  )
);
