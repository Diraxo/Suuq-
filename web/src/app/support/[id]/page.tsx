'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { CaseThread, fetchCaseThread, replyToCase, withdrawAppeal } from '@/lib/supportApi';
import { useModerationStore } from '@/store/moderation';
import { canReply, SUPPORT_TEAM_LABEL } from '@/lib/moderationClient';
import { formatRelativeTime } from '@/lib/time';
import { useT } from '@/lib/i18n';

const STATUS_LABEL: Record<string, string> = { awaiting_staff: 'Waiting for our reply', awaiting_user: 'We replied', resolved: 'Resolved', closed: 'Closed' };

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const t = useT();
  const { id } = use(params);
  const authed = useRequireAuthPage(`/support/${id}`);
  const nonce = useModerationStore((s) => s.messageNonce);
  const [thread, setThread] = useState<CaseThread | null | undefined>(undefined);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setThread(await fetchCaseThread(id));
    } catch {
      setError(t('support.thread.loadFailed'));
    }
  }, [id]);

  // `nonce` changes when a support message arrives over Realtime, so replies from staff appear without a refresh.
  useEffect(() => {
    if (authed) void load();
  }, [authed, load, nonce]);

  if (!authed) return <div className="min-h-[50vh]" />;
  if (thread === undefined) return <p className="px-4 py-10 text-center text-sm text-textSecondary">{error ?? t('common.loading')}</p>;
  if (thread === null) return <p className="px-4 py-10 text-center text-sm text-textSecondary">{t('support.thread.notFound')}</p>;

  const { case: c, messages, appeal } = thread;
  const open = canReply(c);

  const send = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await replyToCase(id, body.trim());
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setBody('');
    void load();
  };

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <Link href="/support" className="mb-3 inline-block text-sm text-primary">
          {t('web.t.noticesSupport')}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold text-textPrimary">{c.subject}</h1>
          <Badge label={STATUS_LABEL[c.status] ? t.text(STATUS_LABEL[c.status]) : c.status} tone={c.status === 'awaiting_user' ? 'accent' : 'neutral'} />
        </div>
        {appeal && (
          <p className="mt-1 text-sm text-textSecondary">
            {t('support.thread.appealStatus', { status: t(`web.m.appeal_${appeal.status}`, { defaultValue: appeal.status }) })}
            {appeal.status === 'pending' && (
              <button
                className="ml-3 text-primary underline"
                onClick={async () => {
                  const r = await withdrawAppeal(appeal.id);
                  if (!r.ok) setError(r.error);
                  else {
                    void useModerationStore.getState().load();
                    void load();
                  }
                }}
              >
                {t('support.thread.withdraw')}
              </button>
            )}
          </p>
        )}

        {c.status === 'awaiting_staff' && (
          <p className="mt-3 rounded-md bg-surface p-3 text-sm text-textSecondary shadow-sm">
            {t('web.m.thanksContacting', { team: SUPPORT_TEAM_LABEL })}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-3" aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={`max-w-[85%] rounded-lg p-3 text-sm ${m.authorKind === 'user' ? 'self-end bg-primary text-primaryText' : m.authorKind === 'system' ? 'self-center bg-transparent text-xs text-textMuted' : 'self-start bg-surface shadow-sm'}`}>
              {m.authorKind === 'staff' && <p className="mb-1 text-xs font-semibold text-primary">{SUPPORT_TEAM_LABEL}</p>}
              {m.authorKind === 'user' && <p className="mb-1 text-xs font-semibold opacity-80">{t('common.you')}</p>}
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className="mt-1 text-[11px] opacity-70">{formatRelativeTime(new Date(m.createdAt).getTime())}</p>
            </div>
          ))}
        </div>

        {open ? (
          <div className="mt-4">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4000} placeholder={t('support.thread.reply')} aria-label={t('chat.reply')} className="w-full rounded-md border border-border bg-inputBackground p-3 text-sm outline-none focus:border-primary" />
            {error && (
              <p className="mt-1 text-sm text-error" role="alert">
                {t.text(error)}
              </p>
            )}
            <div className="mt-2 flex justify-end">
              <Button size="sm" loading={busy} disabled={!body.trim()} onClick={send}>
                {t('common.send')}
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-6 text-center text-sm text-textMuted">
            {t('support.thread.closed')} <Link href="/support/new" className="text-primary underline">{t('support.thread.startNew')}</Link>.
          </p>
        )}
      </div>
    </div>
  );
}
