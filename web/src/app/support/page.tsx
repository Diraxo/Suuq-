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

const STATUS_LABEL: Record<string, string> = { awaiting_staff: 'Waiting for our reply', awaiting_user: 'We replied', resolved: 'Resolved', closed: 'Closed' };

export default function SupportPage() {
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
          <h1 className="text-xl font-bold text-textPrimary">Notices &amp; Support</h1>
          <Link href="/support/new">
            <Button size="sm">Contact support</Button>
          </Link>
        </div>

        {account.status !== 'active' && (
          <Card elevated={false} className="mb-4 border border-warning/40">
            <p className="text-sm font-semibold text-textPrimary">{account.status === 'banned' ? 'Your account is banned' : 'Your account is suspended'}</p>
            <p className="mt-1 text-sm text-textSecondary">
              {account.status === 'suspended' && account.until ? `Until ${new Date(account.until).toLocaleString()}. ` : ''}You can still read this page, appeal the decision and message support.
            </p>
            <Link href={`/support/new?appeal=${account.status === 'banned' ? 'ban' : 'suspension'}`} className="mt-2 inline-block text-sm font-semibold text-primary">
              Appeal this decision
            </Link>
          </Card>
        )}

        {error && (
          <p className="mb-3 text-sm text-error" role="alert">
            Couldn’t load everything. <button className="underline" onClick={() => load()}>Try again</button>
          </p>
        )}

        <h2 className="mb-2 text-sm font-semibold text-textSecondary">Notices from {SUPPORT_TEAM_LABEL}</h2>
        {!hasLoaded ? (
          <p className="py-6 text-center text-sm text-textSecondary">Loading…</p>
        ) : notices.length === 0 ? (
          <p className="mb-6 rounded-md bg-surface p-4 text-sm text-textSecondary shadow-sm">No notices. If we ever take action on your account or a listing, you’ll see it here.</p>
        ) : (
          <div className="mb-6 flex flex-col gap-3">
            {notices.map((n) => {
              const appealKind = n.appealable ? appealKindFor(n.kind) : null;
              return (
                <Card key={n.id} elevated={false} className={n.readAt ? '' : 'border border-primary/40'}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-textPrimary">{n.title}</p>
                    {!n.readAt && <Badge label="New" tone="accent" />}
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
                        Appeal
                      </Link>
                    )}
                    {!n.readAt && (
                      <button className="text-textSecondary" onClick={() => markRead(n.id)}>
                        Mark as read
                      </button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        <h2 className="mb-2 text-sm font-semibold text-textSecondary">Your conversations with support</h2>
        {hasLoaded && cases.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No conversations yet" message="Need help? Contact support and we’ll reply here." actionLabel="Contact support" onAction={() => router.push('/support/new')} />
        ) : (
          <div className="flex flex-col gap-3">
            {cases.map((c) => (
              <Link key={c.id} href={`/support/${c.id}`}>
                <Card elevated={false} className="transition-colors hover:bg-inputBackground">
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-textPrimary">{c.subject}</p>
                    <Badge label={STATUS_LABEL[c.status] ?? c.status} tone={c.status === 'awaiting_user' ? 'accent' : c.status === 'awaiting_staff' ? 'warning' : 'neutral'} />
                  </div>
                  <p className="mt-1 text-xs text-textMuted">Last activity {formatRelativeTime(new Date(c.lastMessageAt).getTime())}</p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
