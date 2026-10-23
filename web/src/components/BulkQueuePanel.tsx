'use client';

// Progress for a queued bulk import on the website — the browser twin of components/BulkQueuePanel.tsx. The server scans and
// watermarks the photos in the background; this only (a) shows progress, (b) publishes each row the server marked ready,
// through the same database-guarded listing write as every other listing and using the watermarked URLs (never the CSV's
// own links), and (c) offers Retry / Cancel. It can be closed and reopened: the queue keeps working and ready rows are
// published the next time this page is open.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2 } from '@/lib/icons';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { summarizeBatch } from '@/lib/bulkImageQueue';
import { BulkBatchView, BulkRowView, cancelBulkBatch, fetchBulkBatch, markBulkPublished, retryBulkRow } from '@/lib/bulkQueueClient';
import { placeFor } from '@/lib/bulkUpload';
import { useScanCopy } from '@/lib/i18n';
import { keyFromUrl } from '@/lib/imageScanState';
import { scanBlockFromDbError } from '@/lib/imageScanPolicy';
import type { LocIndex } from '@/lib/locationTree';
import type { Listing } from '@/lib/types';
import { createListing } from '@/services/listings';
import { useT } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth';
import { activeMode, rowPresentation } from '@/lib/profileIdentity';

const POLL_MS = 5000;

type Props = { batchId: string; userId: string; index: LocIndex; onPublishedSome: () => void; onClose: () => void };

export function BulkQueuePanel({ batchId, userId, index, onPublishedSome, onClose }: Props) {
  const t = useT();
  const scanCopy = useScanCopy();
  const [view, setView] = useState<BulkBatchView | null>(null);
  const [lostConnection, setLostConnection] = useState(false);
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({});
  const publishing = useRef(new Set<string>());
  const alive = useRef(true);
  const publishedAny = useRef(false);
  // Latest props for the polling callbacks, so a directory reload doesn't restart the timer.
  // Each row carries the presentation chosen when the batch was queued (rowPresentation). Only rows queued by an older build fall back to the
  // owner's current mode, so switching mode while photos are processed cannot split a batch.
  const presentationRef = useRef<'personal' | 'business'>('personal');
  presentationRef.current = activeMode(useAuthStore((s) => s.profile));
  const indexRef = useRef(index);
  indexRef.current = index;
  const onPublishedRef = useRef(onPublishedSome);
  onPublishedRef.current = onPublishedSome;

  const publishRow = useCallback(
    async (row: BulkRowView) => {
      if (publishing.current.has(row.id) || !row.imageUrls?.length) return;
      publishing.current.add(row.id);
      try {
        const p = row.payload;
        const city = String(p.city ?? '');
        const place = placeFor(indexRef.current, city);
        // The row id is the listing id, so a retry after a lost response upserts the same row instead of duplicating it.
        const { error } = await createListing(userId, {
          id: row.listingId,
          title: String(p.title ?? ''),
          description: String(p.description ?? ''),
          category: String(p.category ?? ''),
          condition: (p.condition as Listing['condition']) ?? 'used',
          price: Number(p.price ?? 0),
          currency: place.currency,
          city,
          region: place.region,
          images: row.imageUrls,
          imageKeys: row.imageUrls.map(keyFromUrl),
          negotiable: false,
          sellerPresentation: rowPresentation(p, presentationRef.current),
        });
        if (error) {
          const block = scanBlockFromDbError(error);
          setPublishErrors((e) => ({ ...e, [row.id]: block ? scanCopy.errors[block] : t('business.bulkUpload.queue.publishFailed') }));
          return;
        }
        await markBulkPublished(row.id);
        publishedAny.current = true;
        setPublishErrors((e) => {
          const { [row.id]: _gone, ...rest } = e;
          return rest;
        });
      } finally {
        publishing.current.delete(row.id);
      }
    },
    [userId],
  );

  const refresh = useCallback(async () => {
    const next = await fetchBulkBatch(batchId);
    if (!alive.current) return;
    if (!next) {
      setLostConnection(true); // keep what is on screen; the next tick tries again
      return;
    }
    setLostConnection(false);
    setView(next);
    for (const row of next.rows) {
      if ((row.status === 'ready' || row.status === 'ready_review') && !publishing.current.has(row.id)) await publishRow(row);
    }
    if (publishedAny.current) {
      publishedAny.current = false;
      onPublishedRef.current();
    }
  }, [batchId, publishRow]);

  useEffect(() => {
    alive.current = true;
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      alive.current = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  const summary = view ? summarizeBatch(view.counts) : null;
  if (!summary || !view) return <p className="py-10 text-center text-sm text-textSecondary">{t('common.loading')}</p>;

  const failedRows = view.rows.filter((r) => r.status === 'failed');
  const changeRows = view.rows.filter((r) => r.status === 'needs_changes');
  const stuckRows = view.rows.filter((r) => publishErrors[r.id]);
  const items = [
    ...failedRows.map((r) => ({ r, kind: 'failed' as const })),
    ...changeRows.map((r) => ({ r, kind: 'changes' as const })),
    ...stuckRows.map((r) => ({ r, kind: 'stuck' as const })),
  ];
  const settled = summary.total - summary.inProgress;
  const problems = summary.failed + summary.needsChanges > 0;

  return (
    <div>
      <div className="flex flex-col items-center py-6 text-center">
        {summary.finished ? (
          problems ? <AlertCircle size={44} className="text-warning" /> : <CheckCircle2 size={44} className="text-success" />
        ) : null}
        <h2 className="mt-2 text-lg font-bold text-textPrimary">{summary.finished ? `${summary.published} ${summary.published === 1 ? 'listing' : 'listings'} published` : t('business.bulkUpload.queue.title')}</h2>
        <p className="mt-1 text-sm text-textSecondary" aria-live="polite">
          {t('business.bulkUpload.queue.progress', { done: settled, total: summary.total })}
        </p>
        <div className="mt-4 h-2 w-full overflow-hidden rounded bg-border" role="progressbar" aria-valuenow={summary.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-primary transition-all" style={{ width: `${summary.percent}%` }} />
        </div>
        {!summary.finished && <p className="mt-3 text-xs text-textMuted">{t('web.t.youCanLeaveThisPage')}</p>}
        {lostConnection && <p className="mt-2 text-xs text-textSecondary">{t('business.bulkUpload.queue.offline')}</p>}
      </div>

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map(({ r, kind }) => (
            <Card key={`${kind}-${r.id}`} className={`border ${kind === 'changes' ? 'border-warning' : 'border-error'}`}>
              <p className="truncate text-sm font-medium text-textPrimary">{r.payload.title || '(untitled)'}</p>
              <p className="mt-0.5 text-xs text-textSecondary">
                {kind === 'failed'
                  ? t('business.bulkUpload.queue.rowFailed')
                  : kind === 'changes'
                    ? t('business.bulkUpload.queue.rowNeedsChanges')
                    : publishErrors[r.id]}
              </p>
              {kind === 'failed' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={async () => {
                    if (await retryBulkRow(r.id)) void refresh();
                  }}
                >
                  {t('chat.retry')}
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      <div className="mt-5 flex gap-3">
        {!summary.finished && (
          <Button
            variant="outline"
            onClick={async () => {
              await cancelBulkBatch(batchId);
              void refresh();
            }}
          >
            {t('business.bulkUpload.queue.cancel')}
          </Button>
        )}
        <Button onClick={onClose}>{summary.finished ? t('common.done') : t('common.close')}</Button>
      </div>
    </div>
  );
}
