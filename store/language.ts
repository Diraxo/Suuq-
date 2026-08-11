import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import i18n, { AppLocale, SUPPORTED_LOCALES } from '@/lib/i18n';

type LanguageState = {
  locale: AppLocale;
  hasHydrated: boolean;
  /** Loads the on-device language choice (for guests, and as the instant-paint
   * value before any account preference is known) and applies it to i18n. */
  load: () => Promise<void>;
  /** User-initiated language change from onboarding or Settings > Language.
   * Applies immediately, persists on-device, and syncs to the account when
   * signed in. */
  setLocale: (locale: AppLocale) => Promise<void>;
};

const LANGUAGE_STORAGE_KEY = '@suuq/language';

function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function applyLocale(locale: AppLocale) {
  if (i18n.language !== locale) i18n.changeLanguage(locale);
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
  locale: 'en',
  hasHydrated: false,

  load: async () => {
    const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    const locale = isAppLocale(stored) ? stored : 'en';
    applyLocale(locale);
    set({ locale, hasHydrated: true });
  },

  setLocale: async (locale) => {
    applyLocale(locale);
    set({ locale });
    AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, locale).catch(() => {});

    const session = useAuthStore.getState().session;
    if (session) {
      await supabase.from('profiles').update({ language: locale }).eq('id', session.user.id);
    }
  },
}));

// Makes the active language follow the signed-in account (see CLAUDE.md
// i18n spec §9/§32): when a profile finishes loading, an explicit
// profile.language always wins over whatever is on this device — this is
// what makes "User A = Somali, log out, User B = Amharic" switch instantly.
// If the account has never set a language (profile.language is null — e.g.
// a brand-new signup), the reverse happens once: this device's current
// choice (from onboarding, or another device via a previous sync) is
// pushed up to become the account's language.
let lastSyncedProfileId: string | null = null;
useAuthStore.subscribe((state) => {
  const profile = state.profile;
  const profileId = profile?.id ?? null;
  if (profileId === lastSyncedProfileId) return;
  lastSyncedProfileId = profileId;
  if (!profile) return;

  const accountLocale = (profile as { language?: string | null }).language;
  if (isAppLocale(accountLocale)) {
    if (accountLocale !== useLanguageStore.getState().locale) {
      applyLocale(accountLocale);
      useLanguageStore.setState({ locale: accountLocale });
      AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, accountLocale).catch(() => {});
    }
  } else {
    const deviceLocale = useLanguageStore.getState().locale;
    supabase.from('profiles').update({ language: deviceLocale }).eq('id', profile.id).then(() => {});
  }
});
