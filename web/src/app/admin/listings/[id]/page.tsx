'use client';

import { use, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { AdminActionModal } from '@/components/AdminActionModal';
import { PhotoChecksCard } from '@/components/PhotoChecksCard';
import { ListingStatusBadge } from '@/components/ListingStatusBadge';
import { AdminListingDetail, getAdminListingDetail, grantBoost, moderateListing, revokeBoost, setVerified } from '@/services/admin';
import { useStaffCan } from '@/lib/staffRole';
import { formatRelativeTime } from '@/lib/time';
import { formatBirr } from '@/lib/currency';

type Modal = null | 'remove' | 'deactivate' | 'restore' | 'boost' | 'verify' | 'unverify' | { revoke: string };

const ACTION_LABEL: Record<string, string> = {
  listing_removed: 'Removed',
  listing_deactivated: 'Deactivated',
  listing_restored: 'Restored',
  warning: 'Warning sent',
  suspension: 'Seller suspended',
  suspension_lifted: 'Suspension lifted',
  suspension_expired: 'Suspension ended',
  ban: 'Seller banned',
  unban: 'Ban lifted',
  appeal_approved: 'Appeal approved',
  appeal_rejected: 'Appeal rejected',
};

export default function AdminListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<AdminListingDetail | null | undefined>(undefined);
  const [modal, setModal] = useState<Modal>(null);
  const [days, setDays] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const canModerate = useStaffCan('moderate_listing');
  const canVerify = useStaffCan('verify');
  const canBoost = useStaffCan('boost');

  const load = () => getAdminListingDetail(id).then(setDetail);
  useEffect(() => {
    load();
  }, [id]);

  if (detail === undefined) return <p className="text-sm text-textSecondary">Loading…</p>;
  if (detail === null) return <p className="text-sm text-textSecondary">Listing not found, or you don’t have access.</p>;

  const { listing, seller, reports, history, boosts, price_drops, appeals } = detail;
  const moderated = listing.status === 'removed' || listing.status === 'deactivated';
  const verified = !!seller.verified_at;
  const liveBoost = boosts.find((b) => !b.revoked_at && new Date(b.ends_at) > new Date());
  const images: string[] = listing.images ?? [];
  const reload = (r: { error?: string }) => {
    if (!r.error) load();
    return r;
  };

  return (
    <div>
      <Link href="/admin/listings" className="mb-4 inline-block text-sm text-primary">
        ← Back to Listings
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-textPrimary">{listing.title}</h1>
            <ListingStatusBadge status={listing.status} />
            {liveBoost && <Badge label="Boosted" tone="accent" />}
          </div>
          <p className="mt-1 text-sm text-textSecondary">
            {formatBirr(Number(listing.price), listing.currency)} · {listing.city ?? 'Unknown city'} · {listing.category ?? 'No category'}
            {listing.negotiable ? ' · Negotiable' : ''}
          </p>
          <p className="text-xs text-textMuted">Posted {formatRelativeTime(new Date(listing.created_at).getTime())} · ID {listing.id}</p>
        </div>
        {canModerate && (
          <div className="flex flex-wrap gap-2">
            {moderated ? (
              <Button size="sm" onClick={() => setModal('restore')}>
                Restore
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setModal('deactivate')}>
                  Deactivate
                </Button>
                <Button variant="danger" size="sm" onClick={() => setModal('remove')}>
                  Remove
                </Button>
              </>
            )}
            {listing.status === 'deactivated' && (
              <Button variant="danger" size="sm" onClick={() => setModal('remove')}>
                Remove permanently
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card elevated={false}>
            {images.length === 0 ? (
              <p className="text-sm text-textMuted">No photos.</p>
            ) : (
              <>
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-skeleton">
                  <Image src={images[activeImage] ?? images[0]} alt={listing.title} fill sizes="(max-width: 1024px) 100vw, 640px" className="object-contain" />
                </div>
                <div className="mt-2 flex gap-2 overflow-x-auto">
                  {images.map((src, i) => (
                    <button key={src} onClick={() => setActiveImage(i)} className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-md border ${i === activeImage ? 'border-primary' : 'border-border'}`} aria-label={`Photo ${i + 1}`}>
                      <Image src={src} alt="" fill sizes="56px" className="object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </Card>

          <PhotoChecksCard listingId={listing.id} onChanged={load} />

          <Card elevated={false}>
            <p className="mb-2 text-sm font-semibold text-textPrimary">Details</p>
            <p className="whitespace-pre-wrap text-sm text-textSecondary">{listing.description || 'No description.'}</p>
            {listing.attributes && Object.keys(listing.attributes).length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {Object.entries(listing.attributes as Record<string, string>).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-textMuted">{k}</dt>
                    <dd className="text-textPrimary">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {price_drops.length > 0 && (
              <p className="mt-3 text-xs text-textMuted">
                Price history: {price_drops.map((d) => `${d.old_price} → ${d.new_price} (${formatRelativeTime(new Date(d.created_at).getTime())})`).join(' · ')}
              </p>
            )}
          </Card>

          <Section title={`Reports (${reports.length})`}>
            {reports.length === 0 ? (
              <Empty text="This listing hasn’t been reported." />
            ) : (
              reports.map((r) => (
                <div key={r.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-textPrimary">{r.reason}</p>
                    <Badge label={r.status} tone={r.status === 'pending' || r.status === 'reviewing' ? 'warning' : 'neutral'} />
                  </div>
                  {r.details && <p className="mt-0.5 text-textSecondary">{r.details}</p>}
                  <p className="mt-0.5 text-xs text-textMuted">
                    {r.reporter_name} · {formatRelativeTime(new Date(r.created_at).getTime())} ·{' '}
                    <Link href={`/admin/reports/${r.id}`} className="text-primary">
                      Open report
                    </Link>
                  </p>
                </div>
              ))
            )}
          </Section>

          <Section title="Moderation history">
            {history.length === 0 ? (
              <Empty text="No moderation actions on this listing yet." />
            ) : (
              history.map((h) => (
                <div key={h.id} className="py-2 text-sm">
                  <p className="font-medium text-textPrimary">
                    {ACTION_LABEL[h.action] ?? h.action} <span className="font-normal text-textMuted">· {h.actor_name} · {formatRelativeTime(new Date(h.created_at).getTime())}</span>
                  </p>
                  <p className="text-textSecondary">Internal: {h.reason}</p>
                  {h.public_message && <p className="text-xs text-textMuted">Told the seller: “{h.public_message}”</p>}
                </div>
              ))
            )}
          </Section>

          {appeals.length > 0 && (
            <Section title={`Appeals (${appeals.length})`}>
              {appeals.map((a) => (
                <div key={a.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Badge label={a.status} tone={a.status === 'pending' ? 'warning' : a.status === 'approved' ? 'success' : 'neutral'} />
                    <Link href={`/admin/support/${a.case_id}`} className="text-xs text-primary">
                      Open case
                    </Link>
                  </div>
                  <p className="mt-1 text-textSecondary">{a.statement}</p>
                  {a.decision_message && <p className="mt-0.5 text-xs text-textMuted">Decision: {a.decision_message}</p>}
                </div>
              ))}
            </Section>
          )}
        </div>

        <div className="space-y-4">
          <Card elevated={false}>
            <div className="flex items-center gap-3">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-skeleton">
                {seller.avatar_url && <Image src={seller.avatar_url} alt="" fill sizes="48px" className="object-cover" />}
              </div>
              <div className="min-w-0">
                <Link href={`/admin/users/${seller.id}`} className="block truncate text-sm font-semibold text-textPrimary hover:text-primary">
                  {seller.full_name ?? 'SUUQIYE user'}
                </Link>
                <p className="truncate text-xs text-textMuted">{seller.email ?? '—'}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {verified && <Badge label="Verified" tone="success" />}
              {seller.account_status !== 'active' && <Badge label={seller.account_status} tone="warning" />}
              {seller.suspended_until && new Date(seller.suspended_until) > new Date() && <Badge label={`until ${new Date(seller.suspended_until).toLocaleDateString()}`} tone="neutral" />}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-textMuted">Member since</dt>
              <dd>{new Date(seller.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</dd>
              <dt className="text-textMuted">Rating</dt>
              <dd>{seller.rating_count > 0 ? `${seller.rating_avg} (${seller.rating_count})` : 'No ratings'}</dd>
              <dt className="text-textMuted">Listings</dt>
              <dd>
                {seller.listings_live} live · {seller.listings_sold} sold · {seller.listings_moderated} moderated
              </dd>
              <dt className="text-textMuted">Warnings</dt>
              <dd>{seller.warnings_count}</dd>
              <dt className="text-textMuted">Reports</dt>
              <dd>
                {seller.reports_against_listings} on listings · {seller.reports_against_user} on user
              </dd>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/admin/listings?sellerId=${seller.id}`} className="text-xs text-primary">
                All listings
              </Link>
              {canVerify && (
                <Button variant="outline" size="sm" onClick={() => setModal(verified ? 'unverify' : 'verify')}>
                  {verified ? 'Remove verification' : 'Verify seller'}
                </Button>
              )}
            </div>
          </Card>

          <Card elevated={false}>
            <p className="mb-2 text-sm font-semibold text-textPrimary">Boost</p>
            {boosts.length === 0 ? (
              <p className="text-sm text-textMuted">Never boosted.</p>
            ) : (
              boosts.map((b) => (
                <div key={b.id} className="border-b border-border py-2 text-sm last:border-0">
                  <p className="text-textPrimary">
                    Until {new Date(b.ends_at).toLocaleString()} {b.revoked_at ? <Badge label="Revoked" tone="neutral" /> : new Date(b.ends_at) > new Date() ? <Badge label="Live" tone="accent" /> : <Badge label="Ended" tone="neutral" />}
                  </p>
                  <p className="text-xs text-textMuted">{b.reason}</p>
                  {canBoost && !b.revoked_at && new Date(b.ends_at) > new Date() && (
                    <button className="mt-1 text-xs text-primary" onClick={() => setModal({ revoke: b.id })}>
                      Revoke
                    </button>
                  )}
                </div>
              ))
            )}
            {canBoost && !liveBoost && (listing.status === 'available' || listing.status === 'reserved') && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setModal('boost')}>
                Grant boost
              </Button>
            )}
          </Card>
        </div>
      </div>

      <AdminActionModal
        open={modal === 'remove'}
        title="Remove listing"
        description="Takes this listing off the marketplace. The seller is told, and can appeal."
        confirmLabel="Remove"
        danger
        showMessage
        onClose={() => setModal(null)}
        onConfirm={async (reason, x) => reload(await moderateListing(id, 'remove', reason, x.message))}
      />
      <AdminActionModal
        open={modal === 'deactivate'}
        title="Deactivate listing"
        description="Hides this listing while it is reviewed. Fully reversible."
        confirmLabel="Deactivate"
        showMessage
        onClose={() => setModal(null)}
        onConfirm={async (reason, x) => reload(await moderateListing(id, 'deactivate', reason, x.message))}
      />
      <AdminActionModal
        open={modal === 'restore'}
        title="Restore listing"
        description="Makes this listing visible again with its previous status."
        confirmLabel="Restore"
        showMessage
        onClose={() => setModal(null)}
        onConfirm={async (reason, x) => reload(await moderateListing(id, 'restore', reason, x.message))}
      />
      <AdminActionModal
        open={modal === 'verify' || modal === 'unverify'}
        title={modal === 'verify' ? 'Verify seller' : 'Remove verification'}
        description={
          modal === 'verify'
            ? 'Shows a Verified badge and includes the seller in the “Verified” filter. This does not mean a phone number or ID was checked unless you checked it.'
            : 'Removes the Verified badge from this seller.'
        }
        confirmLabel={modal === 'verify' ? 'Verify' : 'Remove'}
        danger={modal === 'unverify'}
        onClose={() => setModal(null)}
        onConfirm={async (reason) => reload(await setVerified(seller.id, modal === 'verify', reason))}
      />
      <AdminActionModal
        open={modal === 'boost'}
        title="Grant boost"
        description={`Boosted for ${days} marketplace day${days === 1 ? '' : 's'} (Africa/Addis_Ababa; 1 = until tonight's midnight). Shown as “Boosted today”.`}
        confirmLabel="Grant boost"
        onClose={() => setModal(null)}
        onConfirm={async (reason) => reload(await grantBoost(id, days, reason))}
      />
      {modal === 'boost' && (
        <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-pill bg-surface px-4 py-2 text-sm shadow-md">
          <label>
            Days:{' '}
            <input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} className="w-16 rounded-md border border-border bg-inputBackground px-2 py-1" />
          </label>
        </div>
      )}
      <AdminActionModal
        open={typeof modal === 'object' && modal !== null && 'revoke' in modal}
        title="Revoke boost"
        confirmLabel="Revoke"
        danger
        onClose={() => setModal(null)}
        onConfirm={async (reason) => (typeof modal === 'object' && modal && 'revoke' in modal ? reload(await revokeBoost(modal.revoke, reason)) : {})}
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
