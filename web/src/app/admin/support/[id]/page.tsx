'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { AdminActionModal } from '@/components/AdminActionModal';
import { AdminCaseDetail, decideAppeal, getAdminCaseDetail, setCaseStatus, staffReply } from '@/services/admin';
import { useStaffCan, useStaffRole } from '@/lib/staffRole';
import { formatRelativeTime } from '@/lib/time';

type Modal = null | 'approve' | 'reject';

export default function AdminCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<AdminCaseDetail | null | undefined>(undefined);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const role = useStaffRole();
  const canDecideListing = useStaffCan('moderate_listing');
  const canDecideSuspension = useStaffCan('suspend');
  const canDecideBan = useStaffCan('ban');

  const load = () => getAdminCaseDetail(id).then(setDetail);
  useEffect(() => {
    load();
  }, [id]);

  if (detail === undefined) return <p className="text-sm text-textSecondary">Loading…</p>;
  if (detail === null) return <p className="text-sm text-textSecondary">Case not found, or you don’t have access.</p>;

  const { case: c, user, listing, messages, appeal, history } = detail;
  const closed = c.status === 'closed';
  const canDecide = !!appeal && appeal.status === 'pending' && (appeal.kind === 'listing' ? canDecideListing : appeal.kind === 'suspension' ? canDecideSuspension : canDecideBan);

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    const r = await staffReply(id, body, internal);
    setSending(false);
    if (r.error) return setError(r.error);
    setBody('');
    setInternal(false);
    load();
  };
  const changeStatus = async (s: 'resolved' | 'closed' | 'awaiting_staff') => {
    const r = await setCaseStatus(id, s);
    if (r.error) setError(r.error);
    else load();
  };

  return (
    <div>
      <Link href="/admin/support" className="mb-4 inline-block text-sm text-primary">
        ← Back to Support
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-textPrimary">{c.subject}</h1>
          <p className="mt-1 text-sm text-textSecondary">
            {user ? (
              <Link href={`/admin/users/${user.id}`} className="text-primary">
                {user.full_name ?? user.email ?? 'SUUQIYE user'}
              </Link>
            ) : (
              'Unknown user'
            )}{' '}
            · {c.category} · opened {formatRelativeTime(new Date(c.created_at).getTime())}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge label={c.status.replace('_', ' ')} tone={c.status === 'awaiting_staff' ? 'warning' : 'neutral'} />
            {user && user.account_status !== 'active' && <Badge label={user.account_status} tone="warning" />}
            {listing && (
              <Link href={`/admin/listings/${listing.id}`}>
                <Badge label={`Listing: ${listing.title} (${listing.status})`} tone="accent" />
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!closed && c.status !== 'resolved' && (
            <Button variant="outline" size="sm" onClick={() => changeStatus('resolved')}>
              Mark resolved
            </Button>
          )}
          {!closed && (
            <Button variant="outline" size="sm" onClick={() => changeStatus('closed')}>
              Close
            </Button>
          )}
        </div>
      </div>

      {appeal && (
        <Card elevated={false} className="mt-4 border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-textPrimary">
              {appeal.kind === 'listing' ? 'Listing appeal' : appeal.kind === 'suspension' ? 'Suspension appeal' : 'Ban appeal'} — <span className="capitalize">{appeal.status}</span>
            </p>
            {canDecide && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setModal('approve')}>
                  Approve (restore)
                </Button>
                <Button variant="danger" size="sm" onClick={() => setModal('reject')}>
                  Reject
                </Button>
              </div>
            )}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-textSecondary">{appeal.statement}</p>
          {appeal.decision_message && <p className="mt-2 text-xs text-textMuted">Decision message: {appeal.decision_message}</p>}
          {appeal.status === 'pending' && !canDecide && (
            <p className="mt-2 text-xs text-textMuted">
              {appeal.kind === 'ban' ? 'Only an administrator can decide ban appeals.' : 'You don’t have permission to decide this appeal.'} ({role})
            </p>
          )}
        </Card>
      )}

      <Card elevated={false} className="mt-4">
        <div className="space-y-3">
          {messages.map((m) => (
            <div key={m.id} className={`rounded-md p-3 text-sm ${m.internal ? 'border border-dashed border-warning bg-warning/10' : m.author_kind === 'user' ? 'bg-inputBackground' : m.author_kind === 'system' ? 'bg-transparent text-textMuted' : 'bg-primary/10'}`}>
              <p className="mb-1 text-xs font-medium text-textMuted">
                {m.author_kind === 'user' ? user?.full_name ?? 'Seller' : m.author_kind === 'system' ? 'System' : `${m.staff_name ?? 'Staff'} (shown to seller as “Suuqiye Support Team”)`}
                {m.internal && ' · internal note'} · {formatRelativeTime(new Date(m.created_at).getTime())}
              </p>
              <p className="whitespace-pre-wrap text-textPrimary">{m.body}</p>
            </div>
          ))}
        </div>
      </Card>

      {!closed && (
        <div className="mt-4">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder={internal ? 'Internal note (the seller will not see this)' : 'Reply to the seller (sent as “Suuqiye Support Team”)'}
            className="w-full rounded-md border border-border bg-inputBackground p-3 text-sm text-textPrimary outline-none focus:border-primary"
            aria-label="Reply"
          />
          {error && (
            <p className="mt-1 text-sm text-error" role="alert">
              {error}
            </p>
          )}
          <div className="mt-2 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-textSecondary">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
              Internal note
            </label>
            <Button size="sm" loading={sending} disabled={!body.trim()} onClick={send}>
              {internal ? 'Add note' : 'Send reply'}
            </Button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <Card elevated={false} className="mt-6">
          <p className="mb-2 text-sm font-semibold text-textPrimary">Recent moderation history for this seller</p>
          <div className="divide-y divide-border text-sm">
            {history.map((h) => (
              <p key={h.id} className="py-1.5 text-textSecondary">
                <span className="font-medium text-textPrimary">{h.action.replace(/_/g, ' ')}</span> · {h.reason} · {formatRelativeTime(new Date(h.created_at).getTime())}
              </p>
            ))}
          </div>
        </Card>
      )}

      <AdminActionModal
        open={modal !== null}
        title={modal === 'approve' ? 'Approve appeal' : 'Reject appeal'}
        description={
          modal === 'approve'
            ? 'Reverses the original decision (listing restored / suspension lifted / ban lifted). The seller gets one notice.'
            : 'Keeps the original decision. The seller is told and the case is resolved.'
        }
        confirmLabel={modal === 'approve' ? 'Approve' : 'Reject'}
        danger={modal === 'reject'}
        requireReason={false}
        showMessage
        onClose={() => setModal(null)}
        onConfirm={async (_reason, x) => {
          if (!appeal || !modal) return {};
          const r = await decideAppeal(appeal.id, modal, x.message);
          if (!r.error) load();
          return r;
        }}
      />
    </div>
  );
}
