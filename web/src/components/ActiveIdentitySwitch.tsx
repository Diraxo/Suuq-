'use client';

import { useState } from 'react';
import { Store, User } from 'lucide-react';
import { useActiveMode } from '@/hooks/useActiveMode';
import type { ProfileMode } from '@/lib/profileIdentity';
import { useT } from '@/lib/i18n';

const MESSAGES = {
  unavailable: 'Switching profiles is not available yet.',
  failed: 'Could not switch profile. Check your connection and try again.',
} as const;

// Chooses which identity the world sees for this one account. Unlike ProfileModeSwitch (which only picks an editor), this writes
// profiles.active_mode, so other people's pages change too.
export function ActiveIdentitySwitch() {
  const t = useT();
  const { mode, canUseBusiness, busy, switchTo } = useActiveMode();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ProfileMode | null>(null);

  const choose = async (next: ProfileMode) => {
    if (busy || next === mode) return;
    setError(null);
    if (next === 'business' && !canUseBusiness) return;
    setPending(next);
  };

  const confirm = async () => {
    const next = pending;
    setPending(null);
    if (!next) return;
    const result = await switchTo(next);
    if (!result.ok) setError(t.text(MESSAGES[result.reason]));
  };

  const seg = (on: boolean) =>
    `flex flex-1 items-center justify-center gap-1.5 rounded-pill py-2.5 text-sm font-medium transition-colors ${on ? 'bg-primary text-primaryText shadow-sm' : 'text-textSecondary hover:text-textPrimary'}`;

  return (
    <div className="mt-4 w-full max-w-sm">
      <div role="tablist" aria-label={t('business.identity.label')} className="flex rounded-pill bg-inputBackground p-1">
        <button role="tab" aria-selected={mode === 'personal'} disabled={busy} onClick={() => void choose('personal')} className={seg(mode === 'personal')}>
          <User size={15} /> {t('settings.profileMode.personal')}
        </button>
        <button role="tab" aria-selected={mode === 'business'} disabled={busy} onClick={() => void choose('business')} className={seg(mode === 'business')}>
          <Store size={15} /> {t('settings.profileMode.business')}
        </button>
      </div>
      <p className="mt-1.5 text-center text-xs text-textMuted">{busy ? t('business.identity.switching') : `Visitors see your ${mode} profile`}</p>
      {pending && (
        <div role="alertdialog" aria-labelledby="switch-title" className="mt-3 rounded-2xl border border-border bg-surface p-4 text-center shadow-sm">
          <p id="switch-title" className="text-sm font-semibold text-textPrimary">{t('business.identity.confirmTitle', { mode: t(pending === 'business' ? 'settings.profileMode.business' : 'settings.profileMode.personal').toLowerCase() })}</p>
          <p className="mt-1 text-xs text-textSecondary">{t('business.identity.confirmBody', { mode: t(pending === 'business' ? 'settings.profileMode.business' : 'settings.profileMode.personal').toLowerCase() })}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => setPending(null)} className="flex-1 rounded-pill border border-border py-2 text-sm font-medium text-textSecondary hover:bg-inputBackground">{t('common.cancel')}</button>
            <button onClick={() => void confirm()} className="flex-1 rounded-pill bg-primary py-2 text-sm font-semibold text-primaryText hover:opacity-90">{t('business.identity.confirmYes')}</button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-center text-xs text-error">
          {t.text(error)}
        </p>
      )}
    </div>
  );
}
