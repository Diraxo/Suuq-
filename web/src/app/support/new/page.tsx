'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/Button';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { openAppeal, openCase } from '@/lib/supportApi';
import { useModerationStore } from '@/store/moderation';
import { useT } from '@/lib/i18n';

const APPEAL_TITLE: Record<string, string> = {
  listing: 'Appeal a listing decision',
  suspension: 'Appeal your suspension',
  ban: 'Appeal your ban',
};

function NewInner() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const authed = useRequireAuthPage('/support/new');
  const appeal = params.get('appeal'); // listing | suspension | ban | null
  const listingId = params.get('listingId');
  const noticeId = params.get('noticeId');
  const isAppeal = appeal === 'listing' || appeal === 'suspension' || appeal === 'ban';
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!authed) return <div className="min-h-[50vh]" />;

  const min = isAppeal ? 10 : 1;
  const valid = body.trim().length >= min && body.length <= (isAppeal ? 2000 : 4000) && (isAppeal || subject.trim().length >= 3);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const result = isAppeal
      ? await openAppeal({ kind: appeal, listingId: appeal === 'listing' ? listingId : null, statement: body.trim() })
      : await openCase({ subject: subject.trim(), body: body.trim(), listingId, noticeId });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    await useModerationStore.getState().load();
    // An appeal returns the appeal id; the case list reload makes its case reachable from /support.
    router.replace(isAppeal ? '/support' : `/support/${result.value}`);
  };

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-xl">
        <Link href="/support" className="mb-3 inline-block text-sm text-primary">
          {t('web.t.noticesSupport')}
        </Link>
        <h1 className="text-xl font-bold text-textPrimary">{isAppeal ? t.text(APPEAL_TITLE[appeal!]) : t('about.contactSupport')}</h1>
        <p className="mt-1 text-sm text-textSecondary">
          {isAppeal
            ? t('support.new.appealIntro')
            : t('support.new.contactIntro')}
        </p>

        {!isAppeal && (
          <label className="mt-4 block text-sm font-medium text-textPrimary">
            {t('post.fieldLabels.Subject')}
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} className="mt-1 w-full rounded-md border border-border bg-inputBackground p-3 text-sm outline-none focus:border-primary" />
          </label>
        )}
        <label className="mt-4 block text-sm font-medium text-textPrimary">
          {isAppeal ? t('support.new.yourAppeal') : t('business.message')}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            maxLength={isAppeal ? 2000 : 4000}
            className="mt-1 w-full rounded-md border border-border bg-inputBackground p-3 text-sm outline-none focus:border-primary"
          />
        </label>
        <p className="mt-1 text-xs text-textMuted">
          {body.length}/{isAppeal ? 2000 : 4000}
          {isAppeal ? ' · at least 10 characters' : ''}
        </p>

        {error && (
          <p className="mt-3 text-sm text-error" role="alert">
            {t.text(error)}
          </p>
        )}
        <div className="mt-4">
          <Button fullWidth loading={busy} disabled={!valid} onClick={submit}>
            {isAppeal ? t('support.new.submitAppeal') : t('chat.sendMessage')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function NewSupportPage() {
  return (
    <Suspense fallback={<div className="min-h-[50vh]" />}>
      <NewInner />
    </Suspense>
  );
}
