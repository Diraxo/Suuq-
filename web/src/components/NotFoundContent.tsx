'use client';

import Link from 'next/link';
import { Compass } from 'lucide-react';
import { useT } from '@/lib/i18n';

const linkBase = 'inline-flex h-[50px] items-center justify-center rounded-pill px-6 text-[15px] font-semibold transition-opacity active:opacity-80';

// The body of the 404 page, as a client component so it follows the website language.
export function NotFoundContent() {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-inputBackground">
        <Compass size={36} className="text-textMuted" aria-hidden />
      </div>
      <p className="text-sm font-semibold uppercase tracking-widest text-textMuted">{t('web.t.error404')}</p>
      <h1 className="mt-2 text-3xl font-bold text-textPrimary md:text-4xl">{t('web.t.pageNotFound')}</h1>
      <p className="mt-3 max-w-md text-sm text-textSecondary md:text-base">{t('web.t.thePageYouReLooking')}</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href="/" className={`${linkBase} bg-primary text-primaryText`}>
          {t('post.webSell.backHome')}
        </Link>
        <Link href="/search" className={`${linkBase} border-[1.5px] border-primary bg-transparent text-primary`}>
          {t('web.t.browseListings')}
        </Link>
      </div>
    </div>
  );
}
