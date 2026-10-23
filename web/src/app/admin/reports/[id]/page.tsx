'use client';

import { ReactNode, use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ErrorNotice } from '@/components/ErrorNotice';
import { AdminAvatar } from '@/components/AdminAvatar';
import { AdminActionModal, AdminActionExtra } from '@/components/AdminActionModal';
import { X, ChevronLeft, ChevronRight } from '@/lib/icons';
import { useStaffCan } from '@/lib/staffRole';
import { addReportNote, getReportWorkspace, moderateListing, moderateUser, ReportWorkspace, updateReportStatus } from '@/services/admin';
import { ReportStatus } from '@/lib/types';
import { REPORT_STATUS_LABEL, REPORT_STATUS_TONE, REPORT_TYPE_LABEL, reportRef } from '@/lib/reportUi';
import { toAppError } from '@/lib/errors';
import { formatRelativeTime } from '@/lib/time';

const when = (iso: string) => new Date(iso).toLocaleString();

const NEXT_STEPS: Record<ReportStatus, { label: string; next: ReportStatus; danger?: boolean }[]> = {
  pending: [
    { label: 'Start review', next: 'reviewing' },
    { label: 'Dismiss', next: 'dismissed', danger: true },
  ],
  reviewing: [
    { label: 'Mark resolved', next: 'reviewed' },
    { label: 'Dismiss', next: 'dismissed', danger: true },
  ],
  reviewed: [{ label: 'Reopen', next: 'reviewing' }],
  dismissed: [{ label: 'Reopen', next: 'reviewing' }],
};

const ACTION_LABEL: Record<string, string> = {
  listing_removed: 'Listing removed',
  listing_deactivated: 'Listing deactivated',
  listing_restored: 'Listing restored',
  warning: 'Warning sent',
  suspension: 'Account suspended',
  suspension_lifted: 'Suspension lifted',
  suspension_expired: 'Suspension expired',
  ban: 'Account banned',
  unban: 'Ban lifted',
  report_status_change: 'Report status changed',
  report_note: 'Internal note added',
};

const PUSH_LABEL: Record<string, string> = {
  pending: 'in-app saved · push not confirmed',
  sent: 'in-app saved · push sent',
  no_devices: 'in-app saved · no registered device',
  disabled: 'in-app saved · user turned push off',
  failed: 'in-app saved · push failed',
};

type Modal =
  | null
  | { kind: 'status'; next: ReportStatus; label: string; danger?: boolean }
  | { kind: 'user'; action: 'warn' | 'suspend' | 'lift_suspension' | 'ban' | 'unban' }
  | { kind: 'listing'; action: 'remove' | 'deactivate' | 'restore' };

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-textMuted">{title}</p>
        {aside}
      </div>
      <div className="mt-2">{children}</div>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="min-w-0">
      <p className="text-xs text-textMuted">{label}</p>
      <p className="break-words text-sm text-textPrimary">{value}</p>
    </div>
  );
}

function Gallery({ images, title, onOpen }: { images: string[]; title: string; onOpen: (i: number) => void }) {
  const [broken, setBroken] = useState<Record<number, boolean>>({});
  if (images.length === 0) return <p className="text-sm text-textSecondary">This listing has no images.</p>;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
      {images.map((src, i) => (
        <button
          key={`${src}-${i}`}
          onClick={() => !broken[i] && onOpen(i)}
          aria-label={`Open image ${i + 1} of ${images.length}${title ? ` for ${title}` : ''}`}
          className="relative aspect-square overflow-hidden rounded-md bg-inputBackground"
        >
          {broken[i] ? (
            <span className="flex h-full w-full items-center justify-center px-1 text-center text-[11px] text-textMuted">Image unavailable</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setBroken((b) => ({ ...b, [i]: true }))} />
          )}
        </button>
      ))}
    </div>
  );
}

function Lightbox({ images, index, onClose, onIndex }: { images: string[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex((index + 1) % images.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onClose, onIndex]);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [index]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85" onClick={onClose} role="dialog" aria-modal="true" aria-label="Image viewer">
      <button onClick={onClose} aria-label="Close image viewer" className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white">
        <X size={20} />
      </button>
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIndex((index - 1 + images.length) % images.length);
            }}
            aria-label="Previous image"
            className="absolute left-3 rounded-full bg-black/50 p-2 text-white"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIndex((index + 1) % images.length);
            }}
            aria-label="Next image"
            className="absolute right-3 rounded-full bg-black/50 p-2 text-white"
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}
      {failed ? (
        <p className="text-sm text-white">This image could not be loaded (it may have been deleted from storage).</p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={images[index]} alt="" className="max-h-[88vh] max-w-[92vw] object-contain" onClick={(e) => e.stopPropagation()} onError={() => setFailed(true)} />
      )}
      <p className="absolute bottom-4 text-xs text-white/80">
        {index + 1} / {images.length}
      </p>
    </div>
  );
}

export default function AdminReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canStatus = useStaffCan('report_status');
  const canWarn = useStaffCan('warn');
  const canSuspend = useStaffCan('suspend');
  const canBan = useStaffCan('ban');
  const canListing = useStaffCan('moderate_listing');

  const [ws, setWs] = useState<ReportWorkspace | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'notfound'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getReportWorkspace(id);
    if (res.error) {
      setError(new Error(res.error));
      setState('error');
    } else if (res.notFound || !res.data) {
      setState('notfound');
    } else {
      setWs(res.data);
      setState('ready');
    }
  }, [id]);

  useEffect(() => {
    setState('loading');
    load();
  }, [load]);

  // Every write is followed by a re-read so the screen shows the PERSISTED status, never an optimistic guess.
  const finish = async (result: { error?: string }, success: string) => {
    if (result.error) return result;
    await load();
    setNotice(success);
    return result;
  };

  if (state === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading report" className="space-y-3">
        <div className="h-8 w-48 animate-pulse rounded bg-inputBackground" />
        <div className="h-32 animate-pulse rounded-lg bg-inputBackground" />
        <div className="h-48 animate-pulse rounded-lg bg-inputBackground" />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div>
        <Link href="/admin/reports" className="mb-4 inline-block text-sm text-primary">
          ← Back to Reports
        </Link>
        <ErrorNotice
          error={toAppError(error)}
          onRetry={() => {
            setState('loading');
            load();
          }}
        />
      </div>
    );
  }
  if (state === 'notfound' || !ws) {
    return (
      <div>
        <Link href="/admin/reports" className="mb-4 inline-block text-sm text-primary">
          ← Back to Reports
        </Link>
        <p className="text-sm text-textSecondary">Report not found. It may have been deleted along with the reporter’s account.</p>
      </div>
    );
  }

  const { report, reporter, reported_user: ru, listing, review } = ws;
  const l = listing?.listing ?? null;
  const snap = listing?.snapshot ?? null;
  const images = l?.images ?? snap?.images ?? [];
  const title = l?.title ?? snap?.title ?? '';
  const targetIsStaff = !!ru?.is_staff;
  const suspended = ru?.account_status === 'suspended';
  const banned = ru?.account_status === 'banned';

  const saveNote = async () => {
    if (!note.trim() || noteBusy) return;
    setNoteBusy(true);
    setNoteError(null);
    const res = await addReportNote(report.id, note.trim());
    setNoteBusy(false);
    if (res.error) {
      setNoteError(res.error);
      return;
    }
    setNote('');
    await load();
  };

  const userModal = (action: 'warn' | 'suspend' | 'lift_suspension' | 'ban' | 'unban') => {
    const cfg = {
      warn: { title: 'Send a warning', description: 'Records a warning on the account and notifies the user. The reason below stays internal.', confirm: 'Send warning', danger: false, until: false },
      suspend: { title: 'Suspend account', description: 'Blocks posting, messaging, offers and other interactions until the end date. The user is notified and can still appeal.', confirm: 'Suspend account', danger: true, until: true },
      lift_suspension: { title: 'Lift suspension', description: 'Restores the account immediately and notifies the user.', confirm: 'Lift suspension', danger: false, until: false },
      ban: { title: 'Permanently ban account', description: 'Bans the account and hides all of its listings. This is permanent until an admin lifts it.', confirm: 'Permanently ban', danger: true, until: false },
      unban: { title: 'Lift ban', description: 'Restores the account and the listings the ban hid, and notifies the user.', confirm: 'Lift ban', danger: false, until: false },
    }[action];
    return (
      <AdminActionModal
        open={modal?.kind === 'user' && modal.action === action}
        title={cfg.title}
        description={cfg.description}
        confirmLabel={cfg.confirm}
        danger={cfg.danger}
        showMessage
        showUntil={cfg.until}
        confirmPhrase={action === 'ban' ? 'BAN' : undefined}
        onClose={() => setModal(null)}
        onConfirm={async (reason: string, x: AdminActionExtra) =>
          finish(await moderateUser(ru!.id, action, reason, { message: x.message, until: x.until, reportId: report.id }), `${cfg.title}: done. The user has been notified.`)
        }
      />
    );
  };

  const listingModal = (action: 'remove' | 'deactivate' | 'restore') => {
    const cfg = {
      remove: { title: 'Remove listing', description: 'Takes the listing off the marketplace. Photos and data are kept, and it can be restored.', confirm: 'Remove listing', danger: true },
      deactivate: { title: 'Disable listing', description: 'Hides the listing while it is under review. Reversible.', confirm: 'Disable listing', danger: true },
      restore: { title: 'Restore listing', description: 'Puts the listing back to the status it had before moderation.', confirm: 'Restore listing', danger: false },
    }[action];
    return (
      <AdminActionModal
        open={modal?.kind === 'listing' && modal.action === action}
        title={cfg.title}
        description={cfg.description}
        confirmLabel={cfg.confirm}
        danger={cfg.danger}
        showMessage
        onClose={() => setModal(null)}
        onConfirm={async (reason: string, x: AdminActionExtra) =>
          finish(await moderateListing(l!.id, action, reason, x.message, report.id), `${cfg.title}: done. The owner has been notified.`)
        }
      />
    );
  };

  return (
    <div>
      <Link href="/admin/reports" className="mb-4 inline-block text-sm text-primary">
        ← Back to Reports
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-textPrimary">
            {REPORT_TYPE_LABEL[report.target_type]} report <span className="font-mono text-base text-textMuted">{reportRef(report.id)}</span>
          </h1>
          <p className="mt-1 text-xs text-textMuted">
            Filed {when(report.created_at)} ({formatRelativeTime(new Date(report.created_at).getTime())})
            {report.assigned_to && ` · Reviewer: ${report.assigned_to.name}`}
          </p>
        </div>
        <Badge label={REPORT_STATUS_LABEL[report.status]} tone={REPORT_STATUS_TONE[report.status]} />
      </div>

      {notice && (
        <p role="status" className="mt-4 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          {notice}{' '}
          <button className="underline" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}

      <Section title="Report">
        <p className="text-sm font-semibold text-textPrimary">{report.reason}</p>
        {report.details ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-textPrimary">{report.details}</p>
        ) : (
          <p className="mt-2 text-sm text-textSecondary">The reporter did not add an explanation.</p>
        )}
        {report.status !== 'pending' && report.status !== 'reviewing' && (
          <p className="mt-3 text-xs text-textMuted">
            {REPORT_STATUS_LABEL[report.status]}
            {report.reviewed_by && ` by ${report.reviewed_by.name}`}
            {report.resolved_at && ` · ${when(report.resolved_at)}`}
            {report.resolution_note && ` · “${report.resolution_note}”`}
          </p>
        )}
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Reporter">
          {reporter ? (
            <>
              <div className="flex items-center gap-3">
                <AdminAvatar name={reporter.name} url={reporter.avatar_url} size={44} />
                <div className="min-w-0">
                  <Link href={`/admin/users/${reporter.id}`} className="block truncate text-sm font-semibold text-primary">
                    {reporter.name}
                  </Link>
                  <p className="truncate font-mono text-[11px] text-textMuted">{reporter.id}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Field label="Reports filed" value={reporter.reports_filed} />
                <Field label="Acted on" value={reporter.reports_actioned} />
                <Field label="Dismissed" value={reporter.reports_dismissed} />
              </div>
              <p className="mt-2 text-xs text-textMuted">Member since {new Date(reporter.created_at).toLocaleDateString()}</p>
            </>
          ) : (
            <p className="text-sm text-textSecondary">The reporter’s account is no longer available.</p>
          )}
        </Section>

        <Section title={report.target_type === 'listing' ? 'Listing owner' : 'Reported user'}>
          {ru ? (
            <>
              <div className="flex items-center gap-3">
                <AdminAvatar name={ru.name} url={ru.avatar_url} size={44} />
                <div className="min-w-0">
                  <Link href={`/admin/users/${ru.id}`} className="block truncate text-sm font-semibold text-primary">
                    {ru.name}
                  </Link>
                  <p className="truncate font-mono text-[11px] text-textMuted">{ru.id}</p>
                </div>
                <div className="ml-auto flex flex-col items-end gap-1">
                  <Badge label={ru.account_status} tone={ru.account_status === 'active' ? 'success' : 'warning'} />
                  {ru.verified_at && <Badge label="Verified" tone="accent" />}
                </div>
              </div>
              {ru.suspended_until && suspended && <p className="mt-2 text-xs text-textMuted">Suspended until {when(ru.suspended_until)}</p>}
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Field label="Listings" value={`${ru.listings_live} live / ${ru.listings_total}`} />
                <Field label="Warnings" value={ru.warnings_count} />
                <Field label="Reports against" value={ru.reports_against} />
              </div>
              {ru.history.length > 0 && (
                <div className="mt-3 border-t border-border pt-2">
                  <p className="text-xs font-medium text-textSecondary">Moderation history</p>
                  <ul className="mt-1 space-y-1">
                    {ru.history.slice(0, 6).map((h) => (
                      <li key={h.id} className="text-xs text-textMuted">
                        {ACTION_LABEL[h.action] ?? h.action} · {new Date(h.created_at).toLocaleDateString()}
                        {h.until && ` · until ${new Date(h.until).toLocaleDateString()}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-textSecondary">The reported account is no longer available.</p>
          )}
        </Section>
      </div>

      {report.target_type === 'listing' && listing && (
        <Section
          title="Reported listing"
          aside={
            <Badge
              label={{ live: 'Live', moderated: l?.status === 'removed' ? 'Removed' : 'Disabled', expired: 'Expired', deleted: 'Deleted' }[listing.state]}
              tone={listing.state === 'live' ? 'success' : 'warning'}
            />
          }
        >
          {listing.state === 'deleted' && (
            <p className="mb-3 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
              This listing was deleted by its owner or by cleanup. {snap ? 'Showing the limited snapshot saved when the report was filed.' : 'No snapshot is available (it may have been purged under the retention policy).'}
            </p>
          )}
          {listing.state === 'moderated' && (
            <p className="mb-3 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">This listing is hidden from the public. You can see it because you are staff.</p>
          )}
          {(l || snap) && (
            <>
              <h2 className="text-lg font-semibold text-textPrimary">{title}</h2>
              <p className="mt-1 text-base font-bold text-textPrimary">
                {(l?.price ?? snap?.price) !== undefined && `${l?.currency ?? snap?.currency ?? ''} ${Number(l?.price ?? snap?.price).toLocaleString()}`}
                {l?.negotiable && <span className="ml-2 text-xs font-normal text-textMuted">Negotiable</span>}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Category" value={[l?.category ?? snap?.category, l?.subcategory].filter(Boolean).join(' / ')} />
                <Field label="Location" value={[l?.city ?? snap?.city, l?.region].filter(Boolean).join(', ')} />
                <Field label="Condition" value={l?.condition ?? snap?.condition} />
                <Field label="Status" value={l?.status ?? snap?.status} />
                <Field label="Posted" value={(l?.created_at ?? snap?.listing_created_at) && when((l?.created_at ?? snap?.listing_created_at)!)} />
                <Field label="Last updated" value={l?.updated_at && when(l.updated_at)} />
                <Field label="Views" value={l?.views} />
                <Field label="Favorites" value={l?.favorites_count} />
              </div>
              {(l?.description ?? snap?.description) && (
                <div className="mt-3">
                  <p className="text-xs text-textMuted">Description</p>
                  <p className="whitespace-pre-wrap text-sm text-textPrimary">{l?.description ?? snap?.description}</p>
                </div>
              )}
              {l?.attributes && Object.keys(l.attributes).length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {Object.entries(l.attributes).map(([k, v]) => (
                    <Field key={k} label={k.replace(/_/g, ' ')} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
                  ))}
                </div>
              )}
              <div className="mt-4">
                <p className="mb-2 text-xs text-textMuted">Images ({images.length})</p>
                <Gallery images={images} title={title} onOpen={setViewer} />
                {listing.state === 'deleted' && images.length > 0 && <p className="mt-2 text-xs text-textMuted">Stored images may no longer load if they were removed from storage.</p>}
              </div>
              {l && (
                <p className="mt-3 text-xs">
                  <Link href={`/admin/listings/${l.id}`} className="text-primary">
                    Open full listing record →
                  </Link>
                </p>
              )}
            </>
          )}
          {!l && !snap && <p className="text-sm text-textSecondary">The listing no longer exists and no evidence snapshot is available.</p>}
        </Section>
      )}

      {report.target_type === 'review' && (
        <Section title="Reported review">
          {review ? (
            <>
              <p className="text-sm text-textPrimary">{'★'.repeat(review.rating)}{'☆'.repeat(Math.max(0, 5 - review.rating))}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-textPrimary">{review.comment || 'No comment.'}</p>
              <p className="mt-1 text-xs text-textMuted">Written {when(review.created_at)}</p>
            </>
          ) : (
            <p className="text-sm text-textSecondary">This review no longer exists.</p>
          )}
        </Section>
      )}

      {ws.other_reports.length > 0 && (
        <Section title={`Other reports on the same ${report.target_type} (${ws.other_reports.length})`}>
          <ul className="space-y-1">
            {ws.other_reports.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
                <Link href={`/admin/reports/${o.id}`} className="min-w-0 truncate text-primary">
                  {reportRef(o.id)} · {o.reason}
                </Link>
                <span className="shrink-0 text-xs text-textMuted">
                  {o.reporter_name} · {REPORT_STATUS_LABEL[o.status]}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Internal notes" aside={<span className="text-[11px] text-textMuted">Staff only - never shown to users</span>}>
        {ws.notes.length === 0 ? (
          <p className="text-sm text-textSecondary">No notes yet.</p>
        ) : (
          <ul className="space-y-2">
            {ws.notes.map((n) => (
              <li key={n.id} className="rounded-md bg-inputBackground p-2 text-sm text-textPrimary">
                <p className="whitespace-pre-wrap">{n.note}</p>
                <p className="mt-1 text-xs text-textMuted">
                  {n.author_name} · {when(n.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canStatus && (
          <div className="mt-3">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              aria-label="New internal note"
              placeholder="Add an internal note"
              className="w-full rounded-md border border-border bg-inputBackground p-2 text-sm text-textPrimary outline-none focus:border-primary"
            />
            {noteError && (
              <p className="mt-1 text-sm text-error" role="alert">
                {noteError}
              </p>
            )}
            <Button size="sm" className="mt-2" loading={noteBusy} disabled={!note.trim()} onClick={saveNote}>
              Add note
            </Button>
          </div>
        )}
      </Section>

      <Section title="Decision">
        <div className="flex flex-wrap gap-3">
          {canStatus &&
            NEXT_STEPS[report.status].map((step) => (
              <Button key={step.next} variant={step.danger ? 'danger' : 'primary'} size="sm" onClick={() => setModal({ kind: 'status', next: step.next, label: step.label, danger: step.danger })}>
                {step.label}
              </Button>
            ))}
        </div>
        {ru && !targetIsStaff && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 text-xs font-medium text-textSecondary">Account actions on {ru.name}</p>
            <div className="flex flex-wrap gap-3">
              {canWarn && !banned && (
                <Button variant="outline" size="sm" onClick={() => setModal({ kind: 'user', action: 'warn' })}>
                  Send warning
                </Button>
              )}
              {canSuspend && !banned && !suspended && (
                <Button variant="danger" size="sm" onClick={() => setModal({ kind: 'user', action: 'suspend' })}>
                  Suspend…
                </Button>
              )}
              {canSuspend && suspended && (
                <Button size="sm" onClick={() => setModal({ kind: 'user', action: 'lift_suspension' })}>
                  Lift suspension
                </Button>
              )}
              {canBan && !banned && (
                <Button variant="danger" size="sm" onClick={() => setModal({ kind: 'user', action: 'ban' })}>
                  Permanently ban…
                </Button>
              )}
              {canBan && banned && (
                <Button size="sm" onClick={() => setModal({ kind: 'user', action: 'unban' })}>
                  Lift ban
                </Button>
              )}
              <Link href={`/admin/users/${ru.id}`} className="self-center text-sm text-primary">
                Open profile (verification, full history) →
              </Link>
            </div>
          </div>
        )}
        {ru && targetIsStaff && <p className="mt-3 text-xs text-textMuted">This account belongs to staff and cannot be moderated here.</p>}
        {l && canListing && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 text-xs font-medium text-textSecondary">Listing actions</p>
            <div className="flex flex-wrap gap-3">
              {listing?.state === 'live' && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setModal({ kind: 'listing', action: 'deactivate' })}>
                    Disable listing
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setModal({ kind: 'listing', action: 'remove' })}>
                    Remove listing
                  </Button>
                </>
              )}
              {listing?.state === 'moderated' && (
                <Button size="sm" onClick={() => setModal({ kind: 'listing', action: 'restore' })}>
                  Restore listing
                </Button>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section title="Outcome and audit trail">
        {ws.actions.length === 0 && ws.audit.length === 0 ? (
          <p className="text-sm text-textSecondary">No actions have been taken yet.</p>
        ) : (
          <ul className="space-y-2">
            {ws.actions.map((a) => (
              <li key={a.event_id} className="text-sm text-textPrimary">
                <p>
                  <span className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</span>
                  <span className="text-textMuted"> · {a.actor_name} · {when(a.created_at)}</span>
                </p>
                <p className="text-xs text-textMuted">
                  Internal reason: {a.reason}
                  {a.until && ` · until ${when(a.until)}`}
                </p>
                <p className="text-xs text-textMuted">
                  User notification: {a.notified ? PUSH_LABEL[a.push_status ?? 'pending'] ?? 'in-app saved' : 'NOT created'}
                </p>
              </li>
            ))}
            {ws.audit.map((a, i) => (
              <li key={i} className="text-sm text-textPrimary">
                <span className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</span>
                <span className="text-textMuted">
                  {' '}
                  · {a.admin_name} · {when(a.created_at)}
                  {typeof a.metadata?.to === 'string' && ` · ${a.metadata.from ?? '?'} → ${a.metadata.to}`}
                  {a.reason && ` · “${a.reason}”`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {ws.reporter_notification && (
          <p className="mt-3 text-xs text-textMuted">
            Reporter told “{ws.reporter_notification.status === 'reviewed' ? 'reviewed' : 'dismissed'}” · {PUSH_LABEL[ws.reporter_notification.push_status ?? 'pending'] ?? 'in-app saved'}
          </p>
        )}
      </Section>

      <AdminActionModal
        open={modal?.kind === 'status'}
        title={modal?.kind === 'status' ? modal.label : ''}
        description={
          modal?.kind === 'status' && modal.next === 'dismissed'
            ? 'The reporter is told their report was dismissed (without your reason). Your reason is recorded in the audit log.'
            : modal?.kind === 'status' && modal.next === 'reviewed'
              ? 'The reporter is told their report was reviewed. Your note is recorded in the audit log.'
              : 'This note is recorded in the moderation audit log.'
        }
        confirmLabel="Confirm"
        danger={modal?.kind === 'status' && modal.danger}
        requireReason={modal?.kind === 'status' && modal.next === 'dismissed'}
        onClose={() => setModal(null)}
        onConfirm={async (n) => {
          if (modal?.kind !== 'status') return {};
          return finish(await updateReportStatus(report.id, modal.next, n || undefined), `Report is now “${REPORT_STATUS_LABEL[modal.next]}”.`);
        }}
      />
      {ru && (['warn', 'suspend', 'lift_suspension', 'ban', 'unban'] as const).map((a) => <div key={a}>{userModal(a)}</div>)}
      {l && (['remove', 'deactivate', 'restore'] as const).map((a) => <div key={a}>{listingModal(a)}</div>)}

      {viewer !== null && images.length > 0 && <Lightbox images={images} index={viewer} onClose={() => setViewer(null)} onIndex={setViewer} />}
    </div>
  );
}
