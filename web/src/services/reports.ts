// Real report submission, mirroring store/reports.ts on mobile: a plain
// insert into the `reports` table (reporter-scoped RLS, admin-visible via
// a separate select policy — see supabase/migrations/0003_reports.sql and
// 0027_admin_foundation.sql). No RPC, no status write (defaults to
// 'pending' server-side).
import { supabase } from '@/lib/supabase';

export type ReportTargetType = 'listing' | 'user' | 'review';

const keyOf = (targetType: ReportTargetType, targetId: string) => `${targetType}:${targetId}`;

// Mirrors store/reports.ts's client-side dedupe check (backed by the same
// DB unique(reporter_id, target_type, target_id) constraint) so the modal
// can show an "already reported" state instead of letting a duplicate
// submission hit the constraint as a raw error.
export async function listMyReportedKeys(userId: string): Promise<Set<string>> {
  const { data } = await supabase.from('reports').select('target_type, target_id').eq('reporter_id', userId);
  return new Set((data ?? []).map((r) => keyOf(r.target_type as ReportTargetType, r.target_id as string)));
}

export async function submitReport(params: {
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  details: string;
}): Promise<{ error?: string }> {
  const { reporterId, targetType, targetId, reason, details } = params;
  if (targetType === 'user' && targetId === reporterId) return { error: 'You cannot report yourself.' };
  if (targetType === 'user' && targetId === reporterId) return { error: 'You cannot report yourself.' };
  const { error } = await supabase.from('reports').insert({
    reporter_id: reporterId,
    target_type: targetType,
    target_id: targetId,
    reason,
    details: details || null,
  });
  if (error) {
    console.error('[reports] submit failed:', error.message);
    return { error: 'Something went wrong submitting your report. Please try again.' };
  }
  return {};
}
