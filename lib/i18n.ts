import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en/translation.json';
import so from '@/locales/so/translation.json';
import am from '@/locales/am/translation.json';

// The three UI languages this app supports. Language *names* here are the
// native/self-names shown in the picker (onboarding + Settings > Language)
// and must never be run through t() or otherwise translated — see
// store/language.ts and app/(onboarding)/language.tsx.
export const SUPPORTED_LOCALES = ['en', 'so', 'am'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const LANGUAGE_NAMES: Record<AppLocale, string> = {
  en: 'English',
  so: 'Somali',
  am: 'አማርኛ',
};

// All three resource bundles are small and bundled with the app (no remote
// fetch), so init() completes synchronously and there's no loading flicker
// when switching languages.
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    so: { translation: so },
    am: { translation: am },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
