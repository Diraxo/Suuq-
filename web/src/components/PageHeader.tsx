'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft } from '@/lib/icons';
import { useT } from '@/lib/i18n';

// Back button + title row shared by the account sub-pages (same markup My Listings already uses).
export function PageHeader({ title, fallbackHref = '/profile' }: { title: string; fallbackHref?: string }) {
  const t = useT();
  const router = useRouter();
  return (
    <div className="mb-4 flex items-center gap-2">
      <button
        onClick={() => (window.history.length > 1 ? router.back() : router.push(fallbackHref))}
        aria-label={t('components.backButton.goBack')}
        className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface"
      >
        <ChevronLeft size={20} />
      </button>
      <h1 className="text-xl font-bold text-textPrimary">{title}</h1>
    </div>
  );
}
