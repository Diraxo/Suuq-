'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft } from '@/lib/icons';
import { useT } from '@/lib/i18n';

export function LegalPage({ title, sections }: { title: string; sections: { title: string; body: string }[] }) {
  const t = useT();
  const router = useRouter();
  return (
    <div className="px-4 pb-10 pt-4 md:px-6 md:pt-8">
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => router.back()} aria-label={t('common.back')} className="rounded-full p-1 hover:bg-inputBackground">
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-xl font-bold text-textPrimary">{t.text(title)}</h1>
      </div>
      <p className="mb-4 text-xs text-textMuted">{t('settings.legal.lastUpdated')}</p>
      <div className="mx-auto max-w-2xl space-y-5">
        {sections.map((s) => (
          <div key={s.title}>
            <p className="mb-1 text-sm font-semibold text-textPrimary">{t.text(s.title)}</p>
            <p className="text-sm leading-relaxed text-textSecondary">{t.text(s.body)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
