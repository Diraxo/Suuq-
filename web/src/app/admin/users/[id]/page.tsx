'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { AdminActionModal } from '@/components/AdminActionModal';
import { getUserDetail, setAccountStatus, warnUser } from '@/services/admin';
import { formatRelativeTime } from '@/lib/time';

type Detail = Awaited<ReturnType<typeof getUserDetail>>;

export default function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [showWarn, setShowWarn] = useState(false);
  const [showSuspend, setShowSuspend] = useState(false);

  const load = () => {
    getUserDetail(id).then(setDetail);
  };

  useEffect(load, [id]);

  if (!detail) return <p className="text-sm text-textSecondary">Loading…</p>;
  if (!detail.profile) return <p className="text-sm text-textSecondary">User not found.</p>;

  const { profile, listings, reportsAgainst, reportsFiled, reviews, warnings } = detail;
  const suspended = profile.account_status === 'suspended';

  return (
    <div>
      <Link href="/admin/users" className="mb-4 inline-block text-sm text-primary">
        ← Back to Users
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-textPrimary">{profile.full_name ?? 'SUUQIYE user'}</h1>
            {suspended && <Badge label="Suspended" tone="warning" />}
          </div>
          <p className="mt-1 text-sm text-textSecondary">{profile.email ?? '—'}</p>
          <p className="text-xs text-textMuted">
            Member since {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} · {profile.city ?? 'Unknown city'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowWarn(true)}>
            Warn user
          </Button>
          <Button variant={suspended ? 'primary' : 'danger'} size="sm" onClick={() => setShowSuspend(true)}>
            {suspended ? 'Unsuspend' : 'Suspend'}
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Section title={`Listings (${listings.length})`}>
          {listings.length === 0 ? (
            <Empty text="No listings." />
          ) : (
            listings.map((l) => (
              <Link key={l.id} href={`/listing/${l.id}`} className="flex items-center justify-between py-2 text-sm hover:text-primary">
                <span className="truncate">{l.title}</span>
                <Badge label={l.status} tone={l.status === 'removed' ? 'warning' : 'neutral'} />
              </Link>
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
                <p className="text-textPrimary">{r.reviewer.name} rated {r.rating}/5</p>
                {r.comment && <p className="mt-0.5 text-xs text-textSecondary">{r.comment}</p>}
              </div>
            ))
          )}
        </Section>
      </div>

      <AdminActionModal
        open={showWarn}
        title="Warn user"
        description="The user receives this as a notification, and it's recorded on their moderation history."
        confirmLabel="Send warning"
        onClose={() => setShowWarn(false)}
        onConfirm={async (reason) => {
          const result = await warnUser(id, reason);
          if (!result.error) load();
          return result;
        }}
      />

      <AdminActionModal
        open={showSuspend}
        title={suspended ? 'Unsuspend user' : 'Suspend user'}
        description={
          suspended
            ? 'Restores the ability to create listings, offers, reviews, favorites, and follows.'
            : 'Blocks this account from creating listings, offers, reviews, favorites, and follows. Chat is not affected.'
        }
        confirmLabel={suspended ? 'Unsuspend' : 'Suspend'}
        danger={!suspended}
        onClose={() => setShowSuspend(false)}
        onConfirm={async (reason) => {
          const result = await setAccountStatus(id, suspended ? 'active' : 'suspended', reason);
          if (!result.error) load();
          return result;
        }}
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
