'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { AdminActionModal } from '@/components/AdminActionModal';
import { AdminScanImage, ISSUE_LABEL, isHeld, listScanImages, loadEvidence, promoteHeldImage, reviewScanImage } from '@/services/adminScans';
import { useStaffCan } from '@/lib/staffRole';

type Decision = 'approve' | 'reject' | 'request_replacement';
const REVIEW_LABEL: Record<AdminScanImage['review_status'], string> = {
  not_needed: 'No review needed',
  pending: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
  replacement_requested: 'Replacement requested',
};

/** Automatic photo-check results for one listing, with the staff review actions. Hidden when the listing has no scans. */
export function PhotoChecksCard({ listingId, onChanged }: { listingId: string; onChanged: () => void }) {
  const canReview = useStaffCan('moderate_listing');
  const [rows, setRows] = useState<AdminScanImage[] | undefined>(undefined);
  const [modal, setModal] = useState<{ img: AdminScanImage; decision: Decision } | null>(null);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => listScanImages(listingId).then(setRows), [listingId]);
  useEffect(() => {
    load();
  }, [load]);
  // Blob URLs hold evidence in memory — release them when the card goes away.
  useEffect(
    () => () => Object.values(shown).forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u)),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!rows || rows.length === 0) return null;

  const show = async (img: AdminScanImage) => {
    const url = await loadEvidence(img.id);
    setShown((s) => ({ ...s, [img.id]: url ?? 'gone' }));
  };

  return (
    <Card elevated={false}>
      <p className="mb-1 text-sm font-semibold text-textPrimary">Photo checks</p>
      <p className="mb-3 text-xs text-textMuted">Automatic results are signals, not verdicts. Photos stay hidden until you choose to show them.</p>
      {notice && (
        <p role="status" className="mb-2 text-sm text-textSecondary">
          {notice}
        </p>
      )}
      <ul className="space-y-3">
        {rows.map((img) => (
          <li key={img.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-textPrimary">Photo {img.slot + 1}</span>
              <Badge label={img.verdict} />
              <Badge label={REVIEW_LABEL[img.review_status]} />
              {img.scan.flagged_for_staff && <Badge label="Flagged" />}
            </div>
            {img.issues.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-textSecondary">
                {img.issues.map((c) => (
                  <li key={c}>{ISSUE_LABEL[c] ?? c}</li>
                ))}
              </ul>
            )}
            {Object.keys(img.internal).length > 0 && (
              <p className="mt-2 break-words font-mono text-xs text-textMuted">
                {Object.entries(img.internal)
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(' · ')}
              </p>
            )}
            {img.review_reason && <p className="mt-1 text-xs text-textMuted">Reviewer note: {img.review_reason}</p>}

            <div className="mt-2">
              {shown[img.id] === undefined ? (
                <Button variant="outline" size="sm" onClick={() => show(img)}>
                  Show photo
                </Button>
              ) : shown[img.id] === 'gone' ? (
                <p className="text-xs text-textMuted">Photo not available (already removed under the retention policy, or no access).</p>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shown[img.id]} alt={`Photo ${img.slot + 1} under review`} className="max-h-72 rounded-md" />
              )}
            </div>

            {canReview && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setModal({ img, decision: 'approve' })}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setModal({ img, decision: 'request_replacement' })}>
                  Request replacement
                </Button>
                <Button size="sm" variant="danger" onClick={() => setModal({ img, decision: 'reject' })}>
                  Reject
                </Button>
                {img.review_status === 'approved' && isHeld(img) && (
                  <Button size="sm" variant="outline" onClick={async () => setNotice((await promoteHeldImage(img.id)).error ?? null)}>
                    Publish photo
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {modal && (
        <AdminActionModal
          open
          title={{ approve: 'Approve photo', reject: 'Reject photo', request_replacement: 'Request a replacement photo' }[modal.decision]}
          description={
            modal.decision === 'approve'
              ? 'The listing becomes visible again once no photo is left waiting. The reason below is internal.'
              : 'The seller is notified with a generic message plus anything you write below. The reason is internal and never shown to them.'
          }
          confirmLabel={{ approve: 'Approve', reject: 'Reject', request_replacement: 'Send request' }[modal.decision]}
          danger={modal.decision === 'reject'}
          showMessage={modal.decision !== 'approve'}
          onClose={() => setModal(null)}
          onConfirm={async (reason, extra) => {
            const r = await reviewScanImage(modal.img.id, modal.decision, reason, extra.message);
            if (r.error) return r;
            // A held photo is still private: publish it right after approval so the restored listing has a live image.
            if (modal.decision === 'approve' && isHeld(modal.img)) setNotice((await promoteHeldImage(modal.img.id)).error ?? null);
            setModal(null);
            await load();
            onChanged();
          }}
        />
      )}
    </Card>
  );
}
