'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useModerationStore } from '@/store/moderation';
import { effectiveAccountState } from '@/lib/moderationClient';
import { useT } from '@/lib/i18n';

// Shown to a suspended or banned seller on every page. The state comes from the database (kept live over
// Realtime); the end date is re-evaluated locally every 30s so the banner disappears by itself when a
// suspension ends. The server enforces the restriction regardless of what this banner shows.
export function AccountRestrictionBanner() {
  const t = useT();
  const account = useModerationStore((s) => s.account);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const state = effectiveAccountState({ account_status: account.status, suspended_until: account.until }, now);
  if (state.status === 'active') return null;

  const banned = state.status === 'banned';
  return (
    <div role="alert" className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm text-textPrimary">
      {banned
        ? t('support.banner.banned')
        : (state.until ? t('support.banner.suspended', { date: new Date(state.until).toLocaleString() }) : t('support.banner.suspendedNoDate'))}{' '}
      <Link href="/support" className="font-semibold text-primary underline">
        {t('support.banner.details')}
      </Link>
    </div>
  );
}
