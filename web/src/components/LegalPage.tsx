'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft } from '@/lib/icons';

export function LegalPage({ title, sections }: { title: string; sections: { title: string; body: string }[] }) {
  const router = useRouter();
  return (
    <div className="px-4 pb-10 pt-4 md:px-6 md:pt-8">
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => router.back()} aria-label="Back" className="rounded-full p-1 hover:bg-inputBackground">
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-xl font-bold text-textPrimary">{title}</h1>
      </div>
      <p className="mb-4 text-xs text-textMuted">Last updated: August 2026</p>
      <div className="mx-auto max-w-2xl space-y-5">
        {sections.map((s) => (
          <div key={s.title}>
            <p className="mb-1 text-sm font-semibold text-textPrimary">{s.title}</p>
            <p className="text-sm leading-relaxed text-textSecondary">{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
