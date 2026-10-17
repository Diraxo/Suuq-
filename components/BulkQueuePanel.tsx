import { useCallback, useEffect, useRef, useState } from 'react';
import { View, FlatList } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { summarizeBatch } from '@/lib/bulkImageQueue';
import { cancelBulkBatch, fetchBulkBatch, markBulkPublished, retryBulkRow, type BulkBatchView, type BulkRowView } from '@/lib/bulkQueueClient';
import { buildListingFromBulkRow } from '@/lib/bulkUpload';
import { keyFromUrl } from '@/lib/imageScanState';
import { listingToRow } from '@/store/myListings';
import { scanBlockFromDbError } from '@/lib/imageScanPolicy';
import { supabase } from '@/lib/supabase';
import type { Listing, Seller } from '@/types';

const POLL_MS = 5000;

type Props = { batchId: string; userId: string; seller: Seller; onPublishedSome: () => void; onClose: () => void };

/**
 * Progress for a queued bulk import. The server scans and watermarks the photos in the background; this screen only
 * (a) shows progress, (b) publishes each row the server marked ready — through the SAME database-guarded listing write
 * as every other listing, using the watermarked derivative URLs — and (c) offers Retry / Cancel. It can be closed and
 * reopened: the queue keeps working and ready rows are published the next time this screen is open.
 */
export function BulkQueuePanel({ batchId, userId, seller, onPublishedSome, onClose }: Props) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const [view, setView] = useState<BulkBatchView | null>(null);
  const [lostConnection, setLostConnection] = useState(false);
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({});
  const publishing = useRef(new Set<string>());
  const alive = useRef(true);
  const publishedAny = useRef(false);

  const publishRow = useCallback(
    async (row: BulkRowView) => {
      if (publishing.current.has(row.id) || !row.imageUrls?.length) return;
      publishing.current.add(row.id);
      try {
        const p = row.payload;
        const listing = {
          ...buildListingFromBulkRow(
            {
              title: String(p.title ?? ''), description: String(p.description ?? ''), price: Number(p.price ?? 0), categoryId: String(p.category ?? ''), categoryName: String(p.categoryName ?? ''),
              condition: (p.condition as Listing['condition']) ?? 'used', city: String(p.city ?? ''), images: row.imageUrls, errors: [],
            },
            seller,
          ),
          id: row.listingId,
          imagePublicIds: row.imageUrls.map(keyFromUrl),
        };
        const { error } = await supabase.from('listings').insert(listingToRow(listing, userId));
        // A retry after a lost response finds the listing already there (duplicate key): that is success, just unmarked.
        const already = error && /duplicate key|already exists/i.test(error.message ?? '');
        if (error && !already) {
          const block = scanBlockFromDbError(error);
          setPublishErrors((e) => ({ ...e, [row.id]: block ? t(`imageScan.errors.${block}`) : t('business.bulkUpload.queue.publishFailed') }));
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
    [seller, userId, t],
  );

  const refresh = useCallback(async () => {
    const next = await fetchBulkBatch(batchId);
    if (!alive.current) return;
    if (!next) {
      setLostConnection(true); // keep what we have on screen; the next tick tries again
      return;
    }
    setLostConnection(false);
    setView(next);
    // Publish what is ready, one at a time (the guard above also stops a second tick re-publishing the same row).
    for (const row of next.rows) {
      if ((row.status === 'ready' || row.status === 'ready_review') && !publishing.current.has(row.id)) await publishRow(row);
    }
    if (publishedAny.current) {
      publishedAny.current = false;
      onPublishedSome();
    }
  }, [batchId, publishRow, onPublishedSome]);

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
  const failedRows = view?.rows.filter((r) => r.status === 'failed') ?? [];
  const changeRows = view?.rows.filter((r) => r.status === 'needs_changes') ?? [];
  const stuckRows = view?.rows.filter((r) => publishErrors[r.id]) ?? [];

  if (!summary) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="body" color="secondary">{t('business.bulkUpload.queue.loading')}</Text>
      </View>
    );
  }

  const settled = summary.total - summary.inProgress;
  return (
    <>
      <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
        <Ionicons name={summary.finished ? (summary.failed + summary.needsChanges > 0 ? 'alert-circle' : 'checkmark-circle') : 'cloud-upload-outline'} size={44} color={summary.finished ? colors.success : colors.primary} />
        <Text variant="h2" style={{ marginTop: spacing.sm }}>
          {summary.finished ? t('business.bulkUpload.queue.doneTitle', { count: summary.published }) : t('business.bulkUpload.queue.title')}
        </Text>
        <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs }} accessibilityLiveRegion="polite">
          {t('business.bulkUpload.queue.progress', { done: settled, total: summary.total })}
        </Text>
        <View style={{ width: '100%', height: 8, borderRadius: 4, backgroundColor: colors.border, marginTop: spacing.md, overflow: 'hidden' }}>
          <View style={{ width: `${summary.percent}%`, height: '100%', backgroundColor: colors.primary }} />
        </View>
        {!summary.finished && (
          <Text variant="caption" color="muted" align="center" style={{ marginTop: spacing.sm }}>
            {t('business.bulkUpload.queue.canLeave')}
          </Text>
        )}
        {lostConnection && (
          <Text variant="caption" color="secondary" align="center" style={{ marginTop: spacing.xs }}>
            {t('business.bulkUpload.queue.offline')}
          </Text>
        )}
      </View>

      <FlatList
        data={[...failedRows.map((r) => ({ r, kind: 'failed' as const })), ...changeRows.map((r) => ({ r, kind: 'changes' as const })), ...stuckRows.map((r) => ({ r, kind: 'stuck' as const }))]}
        keyExtractor={(i) => `${i.kind}-${i.r.id}`}
        ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
        renderItem={({ item }) => (
          <Card elevated={false} style={{ borderWidth: 1, borderColor: item.kind === 'changes' ? colors.warning : colors.error }}>
            <Text variant="bodyMedium" numberOfLines={1}>{item.r.payload.title || t('business.bulkUpload.untitled')}</Text>
            <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
              {item.kind === 'failed' ? t('business.bulkUpload.queue.rowFailed') : item.kind === 'changes' ? t('business.bulkUpload.queue.rowNeedsChanges') : publishErrors[item.r.id]}
            </Text>
            {item.kind === 'failed' && (
              <Button label={t('business.bulkUpload.queue.retry')} size="sm" variant="outline" style={{ marginTop: spacing.xs, alignSelf: 'flex-start' }} onPress={async () => { if (await retryBulkRow(item.r.id)) void refresh(); }} />
            )}
          </Card>
        )}
      />

      <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
        {!summary.finished && (
          <Button
            label={t('business.bulkUpload.queue.cancel')}
            variant="outline"
            onPress={async () => {
              await cancelBulkBatch(batchId);
              void refresh();
            }}
            style={{ flex: 1 }}
          />
        )}
        <Button label={summary.finished ? t('common.done') : t('business.bulkUpload.queue.close')} onPress={onClose} style={{ flex: 1 }} />
      </View>
    </>
  );
}
