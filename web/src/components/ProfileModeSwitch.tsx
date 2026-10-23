'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';

// Personal | Business switch on top of both profile editors. One account, two profiles: it only changes which one is being edited.
export function ProfileModeSwitch({ active }: { active: 'personal' | 'business' }) {
  const t = useT();
  const tab = (on: boolean) => `flex-1 rounded-md py-2 text-center text-sm font-medium ${on ? 'bg-primary text-primaryText shadow-sm' : 'text-textSecondary'}`;
  return (
    <nav aria-label={t('settings.profileMode.label')} className="mt-4 flex rounded-lg bg-inputBackground p-1">
      <Link href="/settings/edit-profile" replace aria-current={active === 'personal' ? 'page' : undefined} className={tab(active === 'personal')}>
        {t('settings.profileMode.personal')}
      </Link>
      <Link href="/settings/business-profile" replace aria-current={active === 'business' ? 'page' : undefined} className={tab(active === 'business')}>
        {t('settings.profileMode.business')}
      </Link>
    </nav>
  );
}
