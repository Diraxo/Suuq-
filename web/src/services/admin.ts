// Admin dashboard (Phase 1) data access — every read here relies on RLS
// policies gated by is_admin() and every write goes through a SECURITY
// DEFINER RPC (see supabase/migrations/0027_admin_foundation.sql). A
// non-admin session gets empty results / a raised Postgres exception from
// these same calls — the frontend gate in app/admin/layout.tsx is UX only,
// this file is not where enforcement happens.
import { supabase } from '@/lib/supabase';
import {
  AccountStatus,
  AdminAuditLogEntry,
  AdminReport,
  AdminUserSummary,
  Listing,
  ModerationWarning,
  Profile,
  ReportStatus,
  ReportTargetType,
  Review,
} from '@/lib/types';

export async function checkIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) return false;
  return data === true;
}

type ReportRow = {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  created_at: string;
};

async function namesForIds(ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids));
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', unique);
  for (const row of (data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
    map.set(row.id, row.full_name ?? row.email ?? 'Fursad user');
  }
  return map;
}

function rowToReport(row: ReportRow, names: Map<string, string>): AdminReport {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    reporterName: names.get(row.reporter_id) ?? 'Fursad user',
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function listReports(filters?: { status?: ReportStatus; targetType?: ReportTargetType }): Promise<AdminReport[]> {
  let query = supabase.from('reports').select('*').order('created_at', { ascending: false });
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.targetType) query = query.eq('target_type', filters.targetType);
  const { data, error } = await query;
  if (error || !data) return [];
  const rows = data as ReportRow[];
  const names = await namesForIds(rows.map((r) => r.reporter_id));
  return rows.map((r) => rowToReport(r, names));
}

export async function getReportDetail(reportId: string): Promise<AdminReport | null> {
  const { data, error } = await supabase.from('reports').select('*').eq('id', reportId).maybeSingle();
  if (error || !data) return null;
  const row = data as ReportRow;
  const names = await namesForIds([row.reporter_id]);
  return rowToReport(row, names);
}

// The reported target: a listing (real uuid row) or a user (profile row).
// 'review' reports have no dedicated detail table wired up yet in this
// phase — the report itself (reason/details) is still fully visible.
export async function getReportTarget(
  targetType: ReportTargetType,
  targetId: string
): Promise<{ listing?: Pick<Listing, 'id' | 'title' | 'images'>; user?: Pick<Profile, 'id' | 'full_name' | 'email' | 'account_status'> } | null> {
  if (targetType === 'listing') {
    const { data } = await supabase.from('listings').select('id, title, images').eq('id', targetId).maybeSingle();
    return data ? { listing: data as Pick<Listing, 'id' | 'title' | 'images'> } : null;
  }
  if (targetType === 'user') {
    const { data } = await supabase.from('profiles').select('id, full_name, email, account_status').eq('id', targetId).maybeSingle();
    return data ? { user: data as Pick<Profile, 'id' | 'full_name' | 'email' | 'account_status'> } : null;
  }
  return null;
}

export async function updateReportStatus(reportId: string, status: ReportStatus, note?: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_update_report_status', { p_report_id: reportId, p_status: status, p_note: note ?? null });
  return error ? { error: error.message } : {};
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export async function listUsers(search?: string): Promise<AdminUserSummary[]> {
  let query = supabase.from('profiles').select('id, full_name, avatar_url, email, city, created_at, account_status').order('created_at', { ascending: false }).limit(100);
  if (search && search.trim()) {
    const term = search.trim();
    query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  const rows = data as Omit<AdminUserSummary, 'listingsCount'>[];
  const ids = rows.map((r) => r.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: listingRows } = await supabase.from('listings').select('user_id').in('user_id', ids);
    for (const row of (listingRows ?? []) as { user_id: string }[]) {
      counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
    }
  }
  return rows.map((r) => ({ ...r, listingsCount: counts.get(r.id) ?? 0 }));
}

export async function getUserDetail(userId: string): Promise<{
  profile: Profile | null;
  listings: Pick<Listing, 'id' | 'title' | 'status'>[];
  reportsAgainst: AdminReport[];
  reportsFiled: AdminReport[];
  reviews: Review[];
  warnings: ModerationWarning[];
}> {
  const [{ data: profile }, { data: listingRows }, { data: reportsAgainstRows }, { data: reportsFiledRows }, { data: reviewRows }, { data: warningRows }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('listings').select('id, title, status, user_id, price, currency, negotiable, condition, category, city, region, images, description, views, favorites_count, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('reports').select('*').eq('target_type', 'user').eq('target_id', userId).order('created_at', { ascending: false }),
    supabase.from('reports').select('*').eq('reporter_id', userId).order('created_at', { ascending: false }),
    supabase.from('reviews').select('id, rating, comment, created_at, reviewer_id').eq('seller_id', userId).order('created_at', { ascending: false }),
    supabase.from('moderation_warnings').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
  ]);

  const reportsAgainstR = (reportsAgainstRows ?? []) as ReportRow[];
  const reportsFiledR = (reportsFiledRows ?? []) as ReportRow[];
  const warningR = (warningRows ?? []) as { id: string; user_id: string; admin_id: string; reason: string; note: string | null; created_at: string }[];
  const reviewR = (reviewRows ?? []) as { id: string; rating: number; comment: string | null; created_at: string; reviewer_id: string }[];

  const names = await namesForIds([
    ...reportsAgainstR.map((r) => r.reporter_id),
    ...reportsFiledR.map((r) => r.reporter_id),
    ...warningR.map((w) => w.admin_id),
    ...reviewR.map((r) => r.reviewer_id),
  ]);

  return {
    profile: (profile as Profile) ?? null,
    listings: (listingRows ?? []) as unknown as Pick<Listing, 'id' | 'title' | 'status'>[],
    reportsAgainst: reportsAgainstR.map((r) => rowToReport(r, names)),
    reportsFiled: reportsFiledR.map((r) => rowToReport(r, names)),
    reviews: reviewR.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.created_at,
      reviewer: { id: r.reviewer_id, name: names.get(r.reviewer_id) ?? 'Fursad user', avatar: '' },
    })),
    warnings: warningR.map((w) => ({
      id: w.id,
      userId: w.user_id,
      adminId: w.admin_id,
      adminName: names.get(w.admin_id) ?? 'Admin',
      reason: w.reason,
      note: w.note,
      createdAt: w.created_at,
    })),
  };
}

export async function warnUser(userId: string, reason: string, note?: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_warn_user', { p_user_id: userId, p_reason: reason, p_note: note ?? null });
  return error ? { error: error.message } : {};
}

export async function setAccountStatus(userId: string, status: AccountStatus, reason: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_set_account_status', { p_user_id: userId, p_status: status, p_reason: reason });
  return error ? { error: error.message } : {};
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------
export async function listListingsForModeration(filters?: { reportedOnly?: boolean }): Promise<
  { id: string; title: string; status: Listing['status']; sellerId: string; sellerName: string; createdAt: string; reportCount: number }[]
> {
  const { data: listingRows, error } = await supabase
    .from('listings')
    .select('id, title, status, user_id, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error || !listingRows) return [];

  const { data: reportRows } = await supabase.from('reports').select('target_id').eq('target_type', 'listing');
  const reportCounts = new Map<string, number>();
  for (const row of (reportRows ?? []) as { target_id: string }[]) {
    reportCounts.set(row.target_id, (reportCounts.get(row.target_id) ?? 0) + 1);
  }

  let rows = listingRows as { id: string; title: string; status: Listing['status']; user_id: string; created_at: string }[];
  if (filters?.reportedOnly) rows = rows.filter((r) => (reportCounts.get(r.id) ?? 0) > 0);

  const names = await namesForIds(rows.map((r) => r.user_id));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    sellerId: r.user_id,
    sellerName: names.get(r.user_id) ?? 'Fursad user',
    createdAt: r.created_at,
    reportCount: reportCounts.get(r.id) ?? 0,
  }));
}

export async function setListingStatus(listingId: string, status: 'available' | 'removed', reason: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_set_listing_status', { p_listing_id: listingId, p_status: status, p_reason: reason });
  return error ? { error: error.message } : {};
}

// ---------------------------------------------------------------------------
// Overview + audit log
// ---------------------------------------------------------------------------
export async function getOverviewStats(): Promise<{
  pendingReports: number;
  reviewingReports: number;
  resolvedReports: number;
  activeUsers: number;
  suspendedUsers: number;
  activeListings: number;
  recentlyReportedListings: { id: string; title: string; createdAt: string }[];
}> {
  const [pending, reviewing, resolved, activeUsers, suspendedUsers, activeListings, recentReports] = await Promise.all([
    supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'reviewing'),
    supabase.from('reports').select('id', { count: 'exact', head: true }).in('status', ['reviewed', 'dismissed']),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('account_status', 'active'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('account_status', 'suspended'),
    supabase.from('listings').select('id', { count: 'exact', head: true }).in('status', ['available', 'reserved']),
    supabase.from('reports').select('target_id, created_at').eq('target_type', 'listing').order('created_at', { ascending: false }).limit(5),
  ]);

  const listingIds = Array.from(new Set(((recentReports.data ?? []) as { target_id: string }[]).map((r) => r.target_id)));
  const titles = new Map<string, string>();
  if (listingIds.length > 0) {
    const { data } = await supabase.from('listings').select('id, title').in('id', listingIds);
    for (const row of (data ?? []) as { id: string; title: string }[]) titles.set(row.id, row.title);
  }

  return {
    pendingReports: pending.count ?? 0,
    reviewingReports: reviewing.count ?? 0,
    resolvedReports: resolved.count ?? 0,
    activeUsers: activeUsers.count ?? 0,
    suspendedUsers: suspendedUsers.count ?? 0,
    activeListings: activeListings.count ?? 0,
    recentlyReportedListings: ((recentReports.data ?? []) as { target_id: string; created_at: string }[]).map((r) => ({
      id: r.target_id,
      title: titles.get(r.target_id) ?? 'Listing no longer available',
      createdAt: r.created_at,
    })),
  };
}

export async function listAuditLog(limit = 100): Promise<AdminAuditLogEntry[]> {
  const { data, error } = await supabase.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error || !data) return [];
  const rows = data as { id: string; admin_id: string; action: string; target_type: string; target_id: string; reason: string | null; created_at: string }[];
  const names = await namesForIds(rows.map((r) => r.admin_id));
  return rows.map((r) => ({
    id: r.id,
    adminId: r.admin_id,
    adminName: names.get(r.admin_id) ?? 'Admin',
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}
