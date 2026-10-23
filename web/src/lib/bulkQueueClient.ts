// App side of the bulk photo queue (migration 0051). Thin RPC wrappers + error mapping; the rules live in the database
// (limits, quota, ownership) and the Worker (fetching, scanning). Nothing here can publish a listing.
import { supabase } from '@/lib/supabase';
import type { BulkCounts, BulkRowStatus } from '@/lib/bulkImageQueue';

export type BulkRowView = {
  id: string;
  listingId: string;
  status: BulkRowStatus;
  attempts: number;
  errorCode: string | null;
  payload: { title?: string; description?: string; price?: number; category?: string; categoryName?: string; condition?: string; city?: string };
  /** The watermarked derivatives, once the row is ready. Never the CSV's own URLs. */
  imageUrls: string[] | null;
};
export type BulkBatchView = { batchId: string; status: 'open' | 'done' | 'cancelled'; totalRows: number; counts: BulkCounts; rows: BulkRowView[] };

export type BulkEnqueueErrorKind = 'disabled' | 'quota' | 'batch_active' | 'too_many_rows' | 'bad_input' | 'failed';

/** Maps the database's refusal (hint set by enqueue_bulk_import) to something the screen can word. */
export function bulkEnqueueErrorKind(err: unknown): BulkEnqueueErrorKind {
  const o = (err && typeof err === 'object' ? err : {}) as { hint?: unknown; message?: unknown };
  const text = `${String(o.hint ?? '')} ${String(o.message ?? '')}`;
  if (/bulk_disabled|not available yet/i.test(text)) return 'disabled';
  if (/bulk_quota_exceeded|allowance exceeded/i.test(text)) return 'quota';
  if (/bulk_batch_active|Finish or cancel/i.test(text)) return 'batch_active';
  if (/bulk_too_many_rows/i.test(text)) return 'too_many_rows';
  if (/bulk_bad_url|bulk_bad_photo_count|Malformed/i.test(text)) return 'bad_input';
  return 'failed';
}

export class BulkEnqueueError extends Error {
  constructor(public kind: BulkEnqueueErrorKind) {
    super(kind);
  }
}

export type BulkInputRow = { payload: Record<string, unknown>; photoUrls: string[] };

export async function enqueueBulk(rows: BulkInputRow[]): Promise<{ batchId: string; rows: { id: string; listingId: string }[] }> {
  const { data, error } = await supabase.rpc('enqueue_bulk_import', { p_rows: rows });
  if (error || !data) throw new BulkEnqueueError(bulkEnqueueErrorKind(error));
  return data as { batchId: string; rows: { id: string; listingId: string }[] };
}

export async function activeBulkBatch(): Promise<string | null> {
  const { data, error } = await supabase.rpc('bulk_active_batch');
  return error ? null : ((data as string | null) ?? null);
}

export async function fetchBulkBatch(batchId: string): Promise<BulkBatchView | null> {
  const { data, error } = await supabase.rpc('bulk_batch_status', { p_batch: batchId });
  return error || !data ? null : (data as BulkBatchView);
}

export async function retryBulkRow(rowId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('bulk_retry_row', { p_row: rowId });
  return !error && data === true;
}

export async function markBulkPublished(rowId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('bulk_mark_published', { p_row: rowId });
  return !error && data === true;
}

export async function cancelBulkBatch(batchId: string): Promise<void> {
  await supabase.rpc('bulk_cancel_batch', { p_batch: batchId });
}
