'use client';

// Staff workspace for businesses (storefronts). Two views: the directory of ALL businesses (publication, verification, owner account,
// active listings, open reports; AdminBusinessDirectory) and the verification-request queue below. Publication (suspend / reinstate) and
// verification (approve / reject / remove) are separate states with separate actions. The queue lists verification requests, opens one (the open itself is audited),
// views documents only through the audited verification-document function (120 s signed URL, one audit row per view), and
// approves / rejects / revokes / suspends / reinstates with a required internal reason. Authorization is enforced by Postgres
// (staff_can('business_review'), admin only); this page and the layout gate are UX only. Reachable only when STOREFRONTS_ENABLED.
import { useCallback, useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { AdminActionModal } from '@/components/AdminActionModal';
import { EmptyState } from '@/components/EmptyState';
import { ShieldCheck } from '@/lib/icons';
import { formatRelativeTime } from '@/lib/time';
import { useStaffCan } from '@/lib/staffRole';
import { STOREFRONTS_ENABLED } from '@/lib/storefrontFlag';
import { ACTION_COPY, ReviewDetail, ReviewListItem, ReviewStatus, StaffAction, documentLabel, identityChanged, reasonOk, reviewActions } from '@/lib/storefrontAdmin';
import { AdminBusinessDirectory } from '@/components/AdminBusinessDirectory';
import {
  decideStorefrontVerification,
  getVerificationDocumentUrl,
  listStorefrontReviews,
  openStorefrontReview,
  revokeStorefrontVerification,
  setStorefrontStatus,
} from '@/services/storefrontAdmin';

const TABS: { key: ReviewStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];
const STATUS_TONE = { pending: 'warning', approved: 'success', rejected: 'neutral' } as const;

type Dialog = StaffAction;
const DIALOG_COPY = ACTION_COPY;

export default function AdminBusinessesPage() {
  if (!STOREFRONTS_ENABLED) notFound();
  return <Businesses />;
}

type View = 'directory' | 'requests';

function Businesses() {
  const canReview = useStaffCan('business_review');
  const [view, setView] = useState<View>('directory');
  // Set when the directory asks to review a pending request: the queue opens it (through the audited open) and clears this.
  const [jumpTo, setJumpTo] = useState<{ requestId: string; businessName: string | null } | null>(null);
  if (!canReview) return <EmptyState icon={ShieldCheck} title="Not available" message="Your role can’t review businesses." />;
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-textPrimary">Businesses</h1>
        <div className="flex gap-1" role="tablist" aria-label="Businesses view">
          {([['directory', 'All businesses'], ['requests', 'Verification requests']] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${view === key ? 'bg-primary text-primaryText' : 'text-textSecondary hover:bg-inputBackground'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === 'directory' ? (
        <AdminBusinessDirectory
          onReviewRequest={(requestId, businessName) => {
            setJumpTo({ requestId, businessName });
            setView('requests');
          }}
        />
      ) : (
        <VerificationRequests jumpTo={jumpTo} onJumped={() => setJumpTo(null)} />
      )}
    </div>
  );
}

function VerificationRequests({ jumpTo, onJumped }: { jumpTo: { requestId: string; businessName: string | null } | null; onJumped: () => void }) {
  const canReview = useStaffCan('business_review');
  const [tab, setTab] = useState<ReviewStatus>('pending');
  const [rows, setRows] = useState<ReviewListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [docBusy, setDocBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setLoadError(null);
    const r = await listStorefrontReviews(tab);
    if (r.error !== null) setLoadError(r.error);
    else setRows(r.data);
  }, [tab]);

  useEffect(() => {
    if (canReview) void load();
  }, [canReview, load]);

  const openById = async (requestId: string) => {
    if (opening) return;
    setOpening(requestId);
    setFlash(null);
    const r = await openStorefrontReview(requestId); // audited
    setOpening(null);
    if (r.error !== null) setFlash({ ok: false, text: r.error });
    else setDetail(r.data);
  };

  useEffect(() => {
    if (!jumpTo) return;
    onJumped();
    void openById(jumpTo.requestId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo]);

  const open = async (item: ReviewListItem) => {
    if (opening) return;
    setOpening(item.requestId);
    setFlash(null);
    const r = await openStorefrontReview(item.requestId); // audited
    setOpening(null);
    if (r.error !== null) setFlash({ ok: false, text: r.error });
    else setDetail(r.data);
  };

  const openDocument = async (path: string) => {
    if (!detail || docBusy) return;
    // Open the window synchronously (inside the click) so a popup blocker allows it; the URL is filled in once authorized.
    const win = window.open('', '_blank');
    setDocBusy(path);
    setFlash(null);
    const r = await getVerificationDocumentUrl(detail.requestId, path);
    setDocBusy(null);
    if (r.error !== null) {
      win?.close();
      setFlash({ ok: false, text: r.error });
      return;
    }
    if (win) {
      win.opener = null;
      win.location.href = r.data.url;
    } else {
      setFlash({ ok: false, text: 'Your browser blocked the new tab. Allow pop-ups for this site and try again.' });
    }
  };

  const confirm = async (reason: string, extra: { message?: string }): Promise<{ error?: string }> => {
    if (!detail || !dialog) return {};
    if (!reasonOk(reason)) return { error: 'Give a reason of at least 10 characters.' };
    const s = detail.storefront;
    const result =
      dialog === 'approve' || dialog === 'reject'
        ? await decideStorefrontVerification(detail.requestId, dialog, reason, extra.message)
        : dialog === 'revoke'
          ? await revokeStorefrontVerification(s.id, reason, extra.message)
          : await setStorefrontStatus(s.id, dialog, reason, extra.message);
    if (result.error) return result;
    setFlash({ ok: true, text: { approve: 'Verification approved.', reject: 'Verification rejected.', revoke: 'Verification removed.', suspend: 'Storefront suspended.', reinstate: 'Storefront reinstated.' }[dialog] });
    // Reflect the change locally. Re-opening the review would write another "opened documents" audit row for no reason.
    // Reinstating restores whatever state the storefront had before suspension (unknown here), so go back to the list rather than guess.
    if (dialog === 'reinstate') setDetail(null);
    else setDetail((d) => {
      if (!d) return d;
      if (dialog === 'approve') return { ...d, status: 'approved', storefront: { ...d.storefront, verificationStatus: 'verified' } };
      if (dialog === 'reject') return { ...d, status: 'rejected', storefront: { ...d.storefront, verificationStatus: 'rejected' } };
      if (dialog === 'revoke') return { ...d, storefront: { ...d.storefront, verificationStatus: 'not_requested' } };
      return { ...d, storefront: { ...d.storefront, status: 'suspended' } };
    });
    void load();
    return {};
  };

  if (detail) {
    const a = reviewActions(detail);
    const s = detail.storefront;
    return (
      <div>
        <button onClick={() => setDetail(null)} className="mb-4 text-sm font-medium text-primary">
          ← Back to requests
        </button>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold text-textPrimary">{detail.submittedName}</h2>
          <Badge label={detail.status} tone={STATUS_TONE[detail.status]} />
          <Badge label={`storefront ${s.status}`} tone={s.status === 'suspended' ? 'warning' : 'neutral'} />
          <Badge label={s.verificationStatus.replace('_', ' ')} tone={s.verificationStatus === 'verified' ? 'success' : 'neutral'} />
        </div>
        {flash && <p className={`mb-3 rounded-md px-3 py-2 text-sm ${flash.ok ? 'bg-success/15 text-success' : 'bg-error/10 text-error'}`} role={flash.ok ? 'status' : 'alert'}>{flash.text}</p>}

        {identityChanged(detail) && detail.status === 'pending' && (
          <p className="mb-3 rounded-md bg-warning/15 px-3 py-2 text-sm text-warning" role="alert">
            The name or address now differs from what the documents were submitted for. It can’t be approved; reject it and ask the owner to resubmit.
          </p>
        )}

        <Card elevated={false} className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-textPrimary">Identity under review</h2>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-textMuted">Submitted name</dt>
            <dd className="text-textPrimary">{detail.submittedName}</dd>
            <dt className="text-textMuted">Submitted address</dt>
            <dd className="text-textPrimary">{detail.submittedAddress ?? '—'}</dd>
            <dt className="text-textMuted">Current name</dt>
            <dd className="text-textPrimary">{s.name ?? '—'}</dd>
            <dt className="text-textMuted">Current address</dt>
            <dd className="text-textPrimary">{s.address ?? '—'}</dd>
            <dt className="text-textMuted">Website</dt>
            <dd className="break-all text-textPrimary">{s.website ?? '—'}</dd>
            <dt className="text-textMuted">Submitted</dt>
            <dd className="text-textPrimary">{formatRelativeTime(new Date(detail.submittedAt).getTime())}</dd>
          </dl>
          {s.description && <p className="mt-3 whitespace-pre-line text-sm text-textSecondary">{s.description}</p>}
          {detail.ownerNote && (
            <p className="mt-3 text-sm text-textPrimary">
              <span className="text-textMuted">Owner’s note: </span>
              {detail.ownerNote}
            </p>
          )}
        </Card>

        <Card elevated={false} className="mb-4">
          <h2 className="mb-1 text-sm font-semibold text-textPrimary">Documents</h2>
          <p className="mb-3 text-xs text-textMuted">Each view is logged with your name. Links open in a new tab and stop working after 2 minutes.</p>
          <div className="flex flex-wrap gap-2">
            {detail.documentPaths.map((p, i) => (
              <Button key={p} size="sm" variant="outline" loading={docBusy === p} disabled={!!docBusy} onClick={() => openDocument(p)}>
                {documentLabel(p, i)}
              </Button>
            ))}
          </div>
        </Card>

        {detail.status !== 'pending' && (
          <Card elevated={false} className="mb-4 text-sm">
            <p className="text-textMuted">Decision</p>
            <p className="text-textPrimary">{detail.decisionReason ?? '—'}</p>
            {detail.reviewedAt && <p className="mt-1 text-xs text-textMuted">{formatRelativeTime(new Date(detail.reviewedAt).getTime())}</p>}
          </Card>
        )}

        <div className="flex flex-wrap gap-2">
          {detail.status === 'pending' && (
            <>
              <Button disabled={!a.approve} onClick={() => setDialog('approve')}>
                Approve
              </Button>
              <Button variant="danger" disabled={!a.reject} onClick={() => setDialog('reject')}>
                Reject
              </Button>
            </>
          )}
          {a.revoke && (
            <Button variant="outline" onClick={() => setDialog('revoke')}>
              Remove verification
            </Button>
          )}
          {a.suspend && (
            <Button variant="outline" onClick={() => setDialog('suspend')}>
              Suspend storefront
            </Button>
          )}
          {a.reinstate && (
            <Button variant="outline" onClick={() => setDialog('reinstate')}>
              Reinstate storefront
            </Button>
          )}
        </div>
        {a.approveBlockedBy === 'suspended' && <p className="mt-2 text-xs text-textMuted">Reinstate the storefront before approving.</p>}

        {dialog && (
          <AdminActionModal
            open
            title={DIALOG_COPY[dialog].title}
            description={DIALOG_COPY[dialog].description}
            confirmLabel={DIALOG_COPY[dialog].confirm}
            danger={DIALOG_COPY[dialog].danger}
            showMessage
            onConfirm={confirm}
            onClose={() => setDialog(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold text-textPrimary">Verification requests</h2>
      <div className="mb-4 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setFlash(null);
            }}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-primary text-primaryText' : 'text-textSecondary hover:bg-inputBackground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {flash && <p className={`mb-3 rounded-md px-3 py-2 text-sm ${flash.ok ? 'bg-success/15 text-success' : 'bg-error/10 text-error'}`} role={flash.ok ? 'status' : 'alert'}>{flash.text}</p>}
      {loadError ? (
        <div role="alert">
          <p className="text-sm text-error">Couldn’t load requests: {loadError}</p>
          <div className="mt-3">
            <Button size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        </div>
      ) : !rows ? (
        <p className="text-sm text-textSecondary">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nothing here" message={tab === 'pending' ? 'No businesses are waiting for verification.' : 'No requests in this list.'} />
      ) : (
        <Card elevated={false} className="divide-y divide-border p-0">
          {rows.map((r) => (
            <div key={r.requestId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-textPrimary">{r.businessName ?? 'Unnamed business'}</span>
                  <Badge label={r.status} tone={STATUS_TONE[r.status]} />
                </div>
                <p className="mt-0.5 text-xs text-textMuted">
                  {r.documentCount} document{r.documentCount === 1 ? '' : 's'} · submitted {formatRelativeTime(new Date(r.submittedAt).getTime())}
                </p>
              </div>
              <Button size="sm" variant="outline" loading={opening === r.requestId} disabled={!!opening} onClick={() => open(r)}>
                Review
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
