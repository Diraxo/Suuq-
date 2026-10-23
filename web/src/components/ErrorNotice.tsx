'use client';

import { AlertCircle } from '@/lib/icons';
import { Button } from './Button';
import type { AppError } from '@/lib/errors';
import { useT } from '@/lib/i18n';

// Inline, titled error surface for the web app. Mirrors the mobile ErrorState
// component's shape (title + message + retry) — use it anywhere a caught error
// needs to be shown to a person: forms, admin lists, detail pages.
//
// Never pass raw error text here; feed it an AppError from toAppError() so the
// copy is already plain-language and the retry affordance matches the kind.
export function ErrorNotice({
  error,
  onRetry,
  onSignIn,
  retrying,
  className = '',
}: {
  error: AppError;
  onRetry?: () => void;
  onSignIn?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  const t = useT();
  const showSignIn = error.kind === 'auth-expired' && !!onSignIn;
  const showRetry = error.retryable && !!onRetry;

  return (
    <div role="alert" className={`rounded-lg border border-error/30 bg-error/5 p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <AlertCircle size={18} className="mt-0.5 shrink-0 text-error" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-textPrimary">{t.text(error.title)}</p>
          <p className="mt-1 text-sm text-textSecondary">{t.text(error.message)}</p>
          {(showSignIn || showRetry) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {showSignIn && (
                <Button size="sm" onClick={onSignIn}>
                  {t('web.t.signInAgain')}
                </Button>
              )}
              {showRetry && (
                <Button size="sm" variant="outline" onClick={onRetry} loading={retrying}>
                  {t('common.retry')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
