'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { AdminActionModal } from '@/components/AdminActionModal';
import { ListingStatusBadge } from '@/components/ListingStatusBadge';
import { getUserDetail, ModerationEventRow, listUserModerationEvents, moderateUser, setVerified } from '@/services/admin';
import { useStaffCan } from '@/lib/staffRole';
import { formatRelativeTime } from '@/lib/time';

type Detail = Awaited<ReturnType<typeof getUserDetail>>;
type Modal = null | 'warn' | 'suspend' | 'lift' | 'ban' | 'unban' | 'verify' | 'unverify';

const ACTION_LABEL: Record<string, string> = {
  listing_removed: 'Listing removed',
  listing_deactivated: 'Listing deactivated',
  listing_restored: 'Listing restored',
  warning: 'Warning',
  suspension: 'Suspended',
  suspension_lifted: 'Suspension lifted',
  suspension_expired: 'Suspension ended',
  ban: 'Banned',
  unban: 'Ban lifted',
  appeal_approved: 'Appeal approved',
  appeal_rejected: 'Appeal rejected',
};

export default function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [events, setEvents] = useState<ModerationEventRow[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const canWarn = useStaffCan('warn');
  const canSuspend = useStaffCan('suspend');
  const canBan = useStaffCan('ban');
  const canVerify = useStaffCan('verify');

  const load = () => {
    getUserDetail(id).then(setDetail);
    listUserModerationEvents(id).then(setEvents);
  };

  useEffect(load, [id]);

  if (!detail) return <p className="text-sm text-textSecondary">Loading…</p>;
  if (!detail.profile) return <p className="text-sm text-textSecondary">User not found.</p>;

  const { profile, listings, reportsAgainst, reportsFiled, reviews, warnings } = detail;
  const banned = profile.account_status === 'banned';
  // A suspension whose end date has passed is already over (the database treats it the same way).
  const suspendedUntil = profile.suspended_until ? new Date(profile.suspended_until) : null;
  const suspended = profile.account_status === 'suspended' && (!suspendedUntil || suspendedUntil > new Date());
  const verified = !!profile.verified_at;
  const done = (r: { error?: string }) => {
    if (!r.error) load();
    return r;
  };

  return (
    <div>
      <Link href="/admin/users" className="mb-4 inline-block text-sm text-primary">
        ← Back to Users
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-textPrimary">{profile.full_name ?? 'SUUQIYE user'}</h1>
            {verified && <Badge label="Verified" tone="success" />}
            {suspended && <Badge label={suspendedUntil ? `Suspended until ${suspendedUntil.toLocaleString()}` : 'Suspended'} tone="warning" />}
            {banned && <Badge label="Banned" tone="warning" />}
          </div>
          <p className="mt-1 text-sm text-textSecondary">{profile.email ?? '—'}</p>
          <p className="text-xs text-textMuted">
            Member since {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} · {profile.city ?? 'Unknown city'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWarn && (
            <Button variant="outline" size="sm" onClick={() => setModal('warn')}>
              Warn user
            </Button>
          )}
          {canSuspend && !banned && (
            <Button variant={suspended ? 'primary' : 'danger'} size="sm" onClick={() => setModal(suspended ? 'lift' : 'suspend')}>
              {suspended ? 'Lift suspension' : 'Suspend'}
            </Button>
          )}
          {canBan && (
            <Button variant={banned ? 'primary' : 'danger'} size="sm" onClick={() => setModal(banned ? 'unban' : 'ban')}>
              {banned ? 'Lift ban' : 'Ban'}
            </Button>
          )}
          {canVerify && (
            <Button variant="outline" size="sm" onClick={() => setModal(verified ? 'unverify' : 'verify')}>
              {verified ? 'Remove verification' : 'Verify'}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Section title={`Listings (${listings.length})`}>
          {listings.length === 0 ? (
            <Empty text="No listings." />
          ) : (
            listings.map((l) => (
              <Link key={l.id} href={`/admin/listings/${l.id}`} className="flex items-center justify-between py-2 text-sm hover:text-primary">
                <span className="truncate">{l.title}</span>
                <ListingStatusBadge status={l.status} />
              </Link>
            ))
          )}
        </Section>

        <Section title={`Moderation history (${events.length})`}>
          {events.length === 0 ? (
            <Empty text="No moderation actions on record." />
          ) : (
            events.map((e) => (
              <div key={e.id} className="py-2 text-sm">
                <p className="font-medium text-textPrimary">
                  {ACTION_LABEL[e.action] ?? e.action} <span className="font-normal text-textMuted">· {formatRelativeTime(new Date(e.created_at).getTime())}</span>
                </p>
                <p className="text-textSecondary">{e.reason}</p>
                {e.until && <p className="text-xs text-textMuted">Until {new Date(e.until).toLocaleString()}</p>}
                {e.listing_id && (
                  <Link href={`/admin/listings/${e.listing_id}`} className="text-xs text-primary">
                    View listing
                  </Link>
                )}
              </div>
            ))
          )}
        </Section>

        <Section title={`Warnings (${warnings.length})`}>
          {warnings.length === 0 ? (
            <Empty text="No warnings on record." />
          ) : (
            warnings.map((w) => (
              <div key={w.id} className="border-b border-border py-2 text-sm last:border-0">
                <p className="text-textPrimary">{w.reason}</p>
                {w.note && <p className="mt-0.5 text-xs text-textSecondary">{w.note}</p>}
                <p className="mt-0.5 text-xs text-textMuted">
                  {w.adminName} · {formatRelativeTime(new Date(w.createdAt).getTime())}
                </p>
              </div>
            ))
          )}
        </Section>

        <Section title={`Reports against this user (${reportsAgainst.length})`}>
          {reportsAgainst.length === 0 ? (
            <Empty text="None." />
          ) : (
            reportsAgainst.map((r) => (
              <Link key={r.id} href={`/admin/reports/${r.id}`} className="flex items-center justify-between py-2 text-sm hover:text-primary">
                <span className="truncate">{r.reason}</span>
                <Badge label={r.status} tone="neutral" />
              </Link>
            ))
          )}
        </Section>

        <Section title={`Reports filed by this user (${reportsFiled.length})`}>
          {reportsFiled.length === 0 ? (
            <Empty text="None." />
          ) : (
            reportsFiled.map((r) => (
              <Link key={r.id} href={`/admin/reports/${r.id}`} className="flex items-center justify-between py-2 text-sm hover:text-primary">
                <span className="truncate">{r.reason}</span>
                <Badge label={r.status} tone="neutral" />
              </Link>
            ))
          )}
        </Section>

        <Section title={`Reviews received (${reviews.length})`}>
          {reviews.length === 0 ? (
            <Empty text="No reviews yet." />
          ) : (
            reviews.map((r) => (
              <div key={r.id} className="border-b border-border py-2 text-sm last:border-0">
                <p className="text-textPrimary">
                  {r.reviewer.name} rated {r.rating}/5
                </p>
                {r.comment && <p className="mt-0.5 text-xs text-textSecondary">{r.comment}</p>}
              </div>
            ))
          )}
        </Section>
      </div>

      <AdminActionModal
        open={modal === 'warn'}
        title="Warn user"
        description="The user is notified (as “Suuqiye Support Team”) and it is recorded in their moderation history."
        confirmLabel="Send warning"
        showMessage
        onClose={() => setModal(null)}
        onConfirm={async (reason, x) => done(await moderateUser(id, 'warn', reason, { message: x.message }))}
      />
      <AdminActionModal
        open={modal === 'suspend'}
        title="Suspend user"
        description="Blocks posting, editing listings, offers, messages, reviews, favorites and follows until the end date. They can still browse, edit their profile settings, appeal and contact support."
        confirmLabel="Suspend"
        danger
        showMessage
        showUntil
        onClose={() => setModal(null)}
        onConfirm={async (reason, x) => done(await moderateUser(id, 'suspend', reason, { message: x.message, until: x.until }))}
      />
      <AdminActionModal
        open={modal === 'lift'}
        title="Lift suspension"
        description="Restores the account immediately."
        confirmLabel="Lift suspension"
        showMessage
        onClose={() => setModal(null)}
        onConfirm={async (reason, x) => done(await moderateUser(id, 'lift_suspension', reason, { message: x.message }))}
      />
      <AdminActionModal
        open={modal === 'ban'}
        title="Ban user permanently"
        description="Blocks the account and hides all of its listings. This can be reversed by an administrator (for example after a successful appeal)."
        confirmLabel="Ban"
        danger
        showMessage
        onClose={() => setModal(null)}
        onConfirm={async (reason, x) => done(await moderateUser(id, 'ban', reason, { message: x.message }))}
      />
      <AdminActionModal
        open={modal === 'unban'}
        title="Lift ban"
        description="Reactivates the account and restores the listings the ban hid (listings removed separately stay removed)."
        confirmLabel="Lift ban"
        showMessage
        onClose={() => setModal(null)}
        onConfirm={async (reason, x) => done(await moderateUser(id, 'unban', reason, { message: x.message }))}
      />
      <AdminActionModal
        open={modal === 'verify' || modal === 'unverify'}
        title={modal === 'verify' ? 'Verify user' : 'Remove verification'}
        description={
          modal === 'verify'
            ? 'Shows a Verified badge and includes this seller in the “Verified” search filter. It does not mean a phone number or ID was checked unless you checked it.'
            : 'Removes the Verified badge.'
        }
        confirmLabel={modal === 'verify' ? 'Verify' : 'Remove'}
        danger={modal === 'unverify'}
        onClose={() => setModal(null)}
        onConfirm={async (reason) => done(await setVerified(id, modal === 'verify', reason))}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card elevated={false}>
      <p className="mb-2 text-sm font-semibold text-textPrimary">{title}</p>
      <div className="divide-y divide-border">{children}</div>
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-2 text-sm text-textMuted">{text}</p>;
}
