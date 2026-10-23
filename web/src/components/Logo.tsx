'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useT } from '@/lib/i18n';

// Real SUUQIYE brand asset (assets/images/fursad-logo.png in the mobile repo)
// — never a text "F" placeholder.
export function Logo({ className = '' }: { className?: string }) {
  const t = useT();
  return (
    <Link href="/" className={`flex items-center gap-2 ${className}`} aria-label={t('web.t.suuqiyeHome')}>
      <Image src="/fursad-logo.png" alt="SUUQIYE" width={32} height={32} className="rounded-lg" priority />
      <span className="text-lg font-bold text-textPrimary">SUUQIYE</span>
    </Link>
  );
}
