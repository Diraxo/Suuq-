'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { MessageSquare } from '@/lib/icons';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { useModerationStore } from '@/store/moderation';
import { appealKindFor, SUPPORT_TEAM_LABEL } from '@/lib/moderationClient';
import { formatRelativeTime } from '@/lib/time';
import { useT } from '@/lib/i18n';

const STATUS_LABEL: Record<string, string> = { awaiting_staff: 'Waiting for our reply', awaiting_user: 'We replied', resolved: 'Resolved', closed: 'Closed' };

export default function SupportPage() {
  const t = useT();
  const router = useRouter();
  const authed = useRequireAuthPage('/support');
  const { notices, cases, account, hasLoaded, error, load, markRead } = useModerationStore();

  useEffect(() => {
    if (authed) void load();
  }, [authed]);

  if (!authed) return <div className="min-h-[50vh]" />;

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-textPrimary">{t('profile.menu.support')}</h1>
          <Link href="/support/new">
            <Button size="sm">{t('about.contactSupport')}</Button>
          </Link>
        </div>

        {account.status !== 'active' && (
          <Card elevated={false} className="mb-4 border border-warning/40">
            <p className="text-sm font-semibold text-textPrimary">{account.status === 'banned' ? t('support.account.banned') : t('support.account.suspended')}</p>
            <p className="mt-1 text-sm text-textSecondary">
              {account.status === 'suspended' && account.until ? `${t('support.account.suspendedUntil', { date: new Date(account.until).toLocaleString() })}. ` : ''}{t('support.account.hint')}
            </p>
            <Link href={`/support/new?appeal=${account.status === 'banned' ? 'ban' : 'suspension'}`} className="mt-2 inline-block text-sm font-semibold text-primary">
              {t('support.appealThisDecision')}
            </Link>
          </Card>
        )}

        {error && (
          <p className="mb-3 text-sm text-error" role="alert">
            {t('web.t.couldnTLoadEverything')} <button className="underline" onClick={() => load()}>{t('common.retry')}</button>
          </p>
        )}

        <h2 className="mb-2 text-sm font-semibold text-textSecondary">{t('support.noticesHeading')}</h2>
        {!hasLoaded ? (
          <p className="py-6 text-center text-sm text-textSecondary">{t('common.loading')}</p>
        ) : notices.length === 0 ? (
          <p className="mb-6 rounded-md bg-surface p-4 text-sm text-textSecondary shadow-sm">{t('support.noNotices')}</p>
        ) : (
          <div className="mb-6 flex flex-col gap-3">
            {notices.map((n) => {
              const appealKind = n.appealable ? appealKindFor(n.kind) : null;
              return (
                <Card key={n.id} elevated={false} className={n.readAt ? '' : 'border border-primary/40'}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-textPrimary">{n.title}</p>
                    {!n.readAt && <Badge label={t('post.details.condition.new')} tone="accent" />}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-textSecondary">{n.body}</p>
                  <p className="mt-2 text-xs text-textMuted">
                    {n.fromLabel} · {formatRelativeTime(new Date(n.createdAt).getTime())}
                  </p>
                  <div className="mt-2 flex gap-3 text-sm">
                    {appealKind && (
                      <Link
                        href={`/support/new?appeal=${appealKind}${n.listingId ? `&listingId=${n.listingId}` : ''}&noticeId=${n.id}`}
                        className="font-semibold text-primary"
                      >
                        {t('support.appeal')}
                      </Link>
                    )}
                    {!n.readAt && (
                      <button className="text-textSecondary" onClick={() => markRead(n.id)}>
                        {t('support.markRead')}
                      </button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        <h2 className="mb-2 text-sm font-semibold text-textSecondary">{t('support.conversationsHeading')}</h2>
        {hasLoaded && cases.length === 0 ? (
          <EmptyState icon={MessageSquare} title={t('chats.emptyTitle')} message={t('support.noConversationsHint')} actionLabel={t('about.contactSupport')} onAction={() => router.push('/support/new')} />
        ) : (
          <div className="flex flex-col gap-3">
            {cases.map((c) => (
              <Link key={c.id} href={`/support/${c.id}`}>
                <Card elevated={false} className="transition-colors hover:bg-inputBackground">
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-textPrimary">{c.subject}</p>
                    <Badge label={STATUS_LABEL[c.status] ? t.text(STATUS_LABEL[c.status]) : c.status} tone={c.status === 'awaiting_user' ? 'accent' : c.status === 'awaiting_staff' ? 'warning' : 'neutral'} />
                  </div>
                  <p className="mt-1 text-xs text-textMuted">{t('web.m.lastActivity', { time: formatRelativeTime(new Date(c.lastMessageAt).getTime()) })}</p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
