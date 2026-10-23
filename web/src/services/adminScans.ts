// Staff access to listing photo-check results (migration 0048 + workers/image-scan). Reads rely on RLS
// (moderator/admin only); decisions go through admin_review_scan_image (audited, seller-notified). Evidence
// photos are fetched through the Worker with the staff JWT — they never sit behind a public URL.
import { supabase } from '@/lib/supabase';

export type ScanIssueCode = string;
export type AdminScanImage = {
  id: string;
  slot: number;
  verdict: 'pass' | 'review' | 'reject';
  issues: ScanIssueCode[];
  internal: Record<string, unknown>;
  review_status: 'not_needed' | 'pending' | 'approved' | 'rejected' | 'replacement_requested';
  review_reason: string | null;
  reviewed_at: string | null;
  public_key: string | null;
  scan: { status: string; category: string; flagged_for_staff: boolean; created_at: string };
};

/** What staff see for each issue code (internal wording; the seller sees different text). */
export const ISSUE_LABEL: Record<string, string> = {
  watermark_own: 'Carries a Suuqiye watermark',
  watermark_other: 'Carries another marketplace’s watermark',
  watermark_uncertain: 'Possible watermark text (unclear)',
  duplicate_listing: 'Near-duplicate of a photo in another listing',
  duplicate_in_batch: 'Same photo twice in this listing',
  prohibited_content: 'Explicit or graphic content (clear)',
  weapon: 'Weapon detected (clear)',
  weapon_uncertain: 'Possible weapon (unclear)',
  content_uncertain: 'Possible explicit or graphic content (unclear)',
  category_mismatch: 'Does not match the selected category',
  category_uncertain: 'Could not identify the item',
  check_failed: 'Automatic check did not complete',
};

/** Held photos have a private (not yet public) derivative that /v1/promote publishes after approval. */
export const isHeld = (img: Pick<AdminScanImage, 'issues'>) => img.issues.some((c) => c === 'content_uncertain' || c === 'weapon_uncertain' || c === 'check_failed');

const WORKER = (process.env.NEXT_PUBLIC_IMAGE_SCAN_URL ?? '').replace(/\/$/, '');

export async function listScanImages(listingId: string): Promise<AdminScanImage[]> {
  const { data, error } = await supabase
    .from('listing_scan_images')
    .select('id, slot, verdict, issues, internal, review_status, review_reason, reviewed_at, public_key, scan:listing_scans!inner(status, category, flagged_for_staff, created_at, listing_id)')
    .eq('listing_scans.listing_id', listingId)
    .order('slot');
  if (error || !data) return [];
  return data as unknown as AdminScanImage[];
}

export async function reviewScanImage(imageId: string, decision: 'approve' | 'reject' | 'request_replacement', reason: string, message?: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_review_scan_image', { p_image_id: imageId, p_decision: decision, p_reason: reason, p_message: message?.trim() || null });
  return error ? { error: error.message } : {};
}

async function workerCall(path: string, init: RequestInit = {}): Promise<Response | null> {
  if (!WORKER) return null;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return fetch(`${WORKER}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) } });
}

/** Loads the stored photo as a blob URL (caller revokes it). null → not available (purged, no access, Worker not configured). */
export async function loadEvidence(imageId: string): Promise<string | null> {
  const res = await workerCall(`/v1/evidence?imageId=${encodeURIComponent(imageId)}`);
  return res?.ok ? URL.createObjectURL(await res.blob()) : null;
}

/** Publishes an approved held photo. Call AFTER reviewScanImage(…, 'approve'). */
export async function promoteHeldImage(imageId: string): Promise<{ error?: string }> {
  const res = await workerCall('/v1/promote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageId }) });
  return res?.ok ? {} : { error: 'Approved, but the photo could not be published yet. Try “Publish photo” again.' };
}
