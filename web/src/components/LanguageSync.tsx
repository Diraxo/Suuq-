'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth';
import { useLanguageStore, SUPPORTED_LOCALES, AppLocale } from '@/store/language';
import { updateProfileLanguage } from '@/services/profile';
import { useLoadWebText } from '@/lib/i18n';

// Mirrors store/language.ts's account-wins sync policy on mobile: the
// device/localStorage choice wins for guests; once signed in, an explicit
// `profiles.language` overrides the local value; if the account has never
// set one (`language` is null), the current local choice is pushed up to
// the account once. Runs once per sign-in (keyed off profile.id changing).
export function LanguageSync() {
  useLoadWebText(); // fetches the chosen language's text (English is bundled)
  const activeLocale = useLanguageStore((s) => s.locale);
  useEffect(() => {
    document.documentElement.lang = activeLocale; // screen readers and browser translation follow the app language
  }, [activeLocale]);
  const lastProfileId = useRef<string | null>(null);

  useEffect(() => {
    return useAuthStore.subscribe((state) => {
      const profile = state.profile;
      if (!profile || profile.id === lastProfileId.current) return;
      lastProfileId.current = profile.id;

      const accountLocale = profile.language;
      if (accountLocale && (SUPPORTED_LOCALES as string[]).includes(accountLocale)) {
        useLanguageStore.setState({ locale: accountLocale as AppLocale });
      } else {
        const deviceLocale = useLanguageStore.getState().locale;
        updateProfileLanguage(profile.id, deviceLocale);
      }
    });
  }, []);

  return null;
}
