// Staff data access for storefront verification (migration 0054 section 8 + the verification-document Edge Function).
// Every call is enforced in Postgres by staff_can('business_review') (admin only today); the admin layout gate is UX only.
// Documents are never read from Storage here: the only path to their bytes is the audited Edge Function.
import { supabase } from '@/lib/supabase';
import { BusinessFilters, BusinessListItem, ReviewDetail, ReviewListItem, ReviewStatus, adminErrorMessage, documentOpenMessage, parseSignedUrl } from '@/lib/storefrontAdmin';

type Result<T> = { data: T; error: null } | { data: null; error: string };

export async function listStorefrontReviews(status: ReviewStatus, limit = 50, offset = 0): Promise<Result<ReviewListItem[]>> {
  const { data, error } = await supabase.rpc('admin_list_storefront_reviews', { p_status: status, p_limit: limit, p_offset: offset });
  if (error) return { data: null, error: adminErrorMessage(error) };
  return { data: (data as ReviewListItem[] | null) ?? [], error: null };
}

/** Every storefront with its owner account, publication, verification, active listings and open reports (migration 0071). Read-only, not audited. */
export async function listBusinesses(f: BusinessFilters, limit = 100, offset = 0): Promise<Result<BusinessListItem[]>> {
  const { data, error } = await supabase.rpc('admin_list_businesses', {
    p_status: f.status,
    p_verification: f.verification,
    p_search: f.search.trim() || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) return { data: null, error: adminErrorMessage(error) };
  return { data: (data as BusinessListItem[] | null) ?? [], error: null };
}

/** Writes an audit row ("Opened verification documents") every time it is called. */
export async function openStorefrontReview(requestId: string): Promise<Result<ReviewDetail>> {
  const { data, error } = await supabase.rpc('admin_get_storefront_review', { p_request: requestId });
  if (error || !data) return { data: null, error: adminErrorMessage(error) };
  return { data: data as ReviewDetail, error: null };
}

export async function decideStorefrontVerification(requestId: string, decision: 'approve' | 'reject', reason: string, message?: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_decide_storefront_verification', { p_request: requestId, p_decision: decision, p_reason: reason, p_message: message ?? null });
  return error ? { error: adminErrorMessage(error) } : {};
}

export async function revokeStorefrontVerification(storefrontId: string, reason: string, message?: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_revoke_storefront_verification', { p_storefront: storefrontId, p_reason: reason, p_message: message ?? null });
  return error ? { error: adminErrorMessage(error) } : {};
}

export async function setStorefrontStatus(storefrontId: string, action: 'suspend' | 'reinstate', reason: string, message?: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_set_storefront_status', { p_storefront: storefrontId, p_action: action, p_reason: reason, p_message: message ?? null });
  return error ? { error: adminErrorMessage(error) } : {};
}

/**
 * Asks the verification-document function for a 120-second signed URL for ONE document. The function authorizes and audits
 * (admin_authorize_verification_document) before it signs; on any failure no URL comes back and nothing is shown.
 */
export async function getVerificationDocumentUrl(requestId: string, path: string): Promise<Result<{ url: string; expiresInSeconds: number }>> {
  const { data, error } = await supabase.functions.invoke('verification-document', { body: { requestId, path } });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status ?? null;
    return { data: null, error: documentOpenMessage(status) };
  }
  const parsed = parseSignedUrl(data);
  return parsed ? { data: parsed, error: null } : { data: null, error: documentOpenMessage(null) };
}
