// Seller-facing moderation + support data access (migrations 0039/0040). Reads go through RLS (a seller can only
// ever read their own notices, cases and messages); every write is a SECURITY DEFINER RPC that re-checks
// ownership, status, size and rate limits in Postgres. Identical copy at web/src/services/support.ts.
import { supabase } from '@/lib/supabase';
import {
  AccountState,
  ACTIVE_ACCOUNT,
  ModerationNotice,
  SupportCase,
  SupportMessage,
  effectiveAccountState,
  rowToCase,
  rowToMessage,
  rowToNotice,
} from '@/lib/moderationClient';

export type ActionResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

/** Turns the database's deliberate error messages into something a seller can act on. */
export function friendlySupportError(message: string | undefined): string {
  const m = message ?? '';
  if (/rate limit/i.test(m)) return 'You’ve reached today’s limit. Please try again tomorrow, or add to an existing case.';
  if (/already have 3 open cases/i.test(m)) return 'You already have 3 open cases. Please add to one of them while you wait for a reply.';
  if (/maximum number of appeals/i.test(m)) return 'This listing has reached the maximum number of appeals.';
  if (/appeal the ban instead/i.test(m)) return 'This listing was hidden because of your account status. Please appeal that decision instead.';
  if (/unique|duplicate|already.*pending/i.test(m)) return 'You already have an appeal waiting for review.';
  if (/case is closed/i.test(m)) return 'This case is closed. Please open a new one.';
  if (/10-2000/.test(m)) return 'Please explain your appeal in at least 10 characters.';
  if (/1-4000/.test(m)) return 'Messages must be between 1 and 4000 characters.';
  if (/sign in/i.test(m)) return 'Please sign in to contact support.';
  return m || 'Something went wrong. Please try again.';
}

export async function fetchAccountState(): Promise<AccountState> {
  // my_account_state() also persists an expired suspension (once), so the app and the database agree.
  const { data, error } = await supabase.rpc('my_account_state');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? effectiveAccountState({ account_status: row.status, suspended_until: row.suspended_until }) : ACTIVE_ACCOUNT;
}

export async function fetchNotices(limit = 50): Promise<ModerationNotice[]> {
  const { data, error } = await supabase.from('moderation_notices').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map(rowToNotice);
}

export async function markNoticeRead(id: string): Promise<void> {
  await supabase.rpc('mark_notice_read', { p_notice_id: id });
}

export async function fetchCases(limit = 50): Promise<SupportCase[]> {
  const { data, error } = await supabase.from('support_cases').select('*').order('last_message_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map(rowToCase);
}

export type CaseThread = { case: SupportCase & { resolvedAt: string | null }; messages: SupportMessage[]; appeal: { id: string; kind: string; status: string; decisionMessage: string | null } | null };

export async function fetchCaseThread(id: string): Promise<CaseThread | null> {
  const [{ data: c, error: ce }, { data: msgs, error: me }, { data: ap }] = await Promise.all([
    supabase.from('support_cases').select('*').eq('id', id).maybeSingle(),
    supabase.from('support_messages').select('*').eq('case_id', id).order('created_at', { ascending: true }),
    supabase.from('moderation_appeals').select('id, kind, status, decision_message').eq('case_id', id).maybeSingle(),
  ]);
  if (ce) throw ce;
  if (me) throw me;
  if (!c) return null;
  return {
    case: { ...rowToCase(c), resolvedAt: (c as any).resolved_at ?? null },
    messages: (msgs ?? []).map(rowToMessage),
    appeal: ap ? { id: (ap as any).id, kind: (ap as any).kind, status: (ap as any).status, decisionMessage: (ap as any).decision_message ?? null } : null,
  };
}

/** Appeal state per listing, so My Listings can show "Appeal pending" instead of offering a second appeal. */
export async function fetchAppealStatusByListing(listingIds: string[]): Promise<Record<string, { status: string; caseId: string }>> {
  if (listingIds.length === 0) return {};
  const { data } = await supabase.from('moderation_appeals').select('listing_id, status, case_id, created_at').in('listing_id', listingIds).order('created_at', { ascending: true });
  const out: Record<string, { status: string; caseId: string }> = {};
  for (const r of (data ?? []) as any[]) out[r.listing_id] = { status: r.status, caseId: r.case_id }; // latest wins
  return out;
}

export async function openCase(input: { subject: string; body: string; category?: 'general' | 'account' | 'listing'; listingId?: string | null; noticeId?: string | null }): Promise<ActionResult<string>> {
  const { data, error } = await supabase.rpc('support_open_case', {
    p_subject: input.subject,
    p_body: input.body,
    p_category: input.category ?? 'general',
    p_listing_id: input.listingId ?? null,
    p_notice_id: input.noticeId ?? null,
  });
  return error ? { ok: false, error: friendlySupportError(error.message) } : { ok: true, value: data as string };
}

export async function replyToCase(caseId: string, body: string): Promise<ActionResult<string>> {
  const { data, error } = await supabase.rpc('support_reply', { p_case_id: caseId, p_body: body });
  return error ? { ok: false, error: friendlySupportError(error.message) } : { ok: true, value: data as string };
}

export async function openAppeal(input: { kind: 'listing' | 'suspension' | 'ban'; listingId?: string | null; statement: string }): Promise<ActionResult<string>> {
  const { data, error } = await supabase.rpc('support_open_appeal', { p_kind: input.kind, p_listing_id: input.listingId ?? null, p_statement: input.statement });
  return error ? { ok: false, error: friendlySupportError(error.message) } : { ok: true, value: data as string };
}

export async function withdrawAppeal(appealId: string): Promise<ActionResult<null>> {
  const { error } = await supabase.rpc('support_withdraw_appeal', { p_appeal_id: appealId });
  return error ? { ok: false, error: friendlySupportError(error.message) } : { ok: true, value: null };
}
