'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, CheckCircle2 } from '@/lib/icons';
import { useLanguageStore, LANGUAGE_NAMES, SUPPORTED_LOCALES, AppLocale } from '@/store/language';
import { useT } from '@/lib/i18n';

// Mirrors app/settings/language.tsx (and the onboarding language step) on
// mobile: single-select only — picking a language always replaces the
// previous choice, never adds to it.
export default function LanguagePage() {
  const t = useT();
  const router = useRouter();
  const locale = useLanguageStore((s) => s.locale);
  const setLocale = useLanguageStore((s) => s.setLocale);

  return (
    <div className="px-4 pb-10 pt-4 md:px-6 md:pt-8">
      <div className="mb-5 flex items-center gap-2">
        <button onClick={() => router.back()} aria-label={t('common.back')} className="rounded-full p-1 hover:bg-inputBackground">
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-xl font-bold text-textPrimary">{t('settings.language')}</h1>
      </div>
      <div className="mx-auto max-w-md space-y-3">
        {SUPPORTED_LOCALES.map((code: AppLocale) => {
          const selected = locale === code;
          return (
            <button
              key={code}
              onClick={() => setLocale(code)}
              aria-pressed={selected}
              className={`flex w-full items-center justify-between rounded-lg border-[1.5px] px-5 py-4 text-left ${
                selected ? 'border-primary bg-primary/5' : 'border-border bg-surface'
              }`}
            >
              <span className={`text-lg font-semibold ${selected ? 'text-primary' : 'text-textPrimary'}`}>{LANGUAGE_NAMES[code]}</span>
              {selected && <CheckCircle2 size={22} className="text-primary" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
