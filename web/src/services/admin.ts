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
    map.set(row.id, row.full_name ?? row.email ?? 'SUUQIYE user');
  }
  return map;
}

function rowToReport(row: ReportRow, names: Map<string, string>): AdminReport {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    reporterName: names.get(row.reporter_id) ?? 'SUUQIYE user',
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Report review workspace (migration 0047). Both reads are SECURITY DEFINER RPCs that re-check
// staff_can('report_status') in Postgres - the raw tables are never read from the browser for evidence.
// ---------------------------------------------------------------------------
export type ReportQueueFilters = {
  status?: ReportStatus | null;
  targetType?: ReportTargetType | null;
  query?: string;
  from?: string | null;
  to?: string | null;
  assignedTo?: string | null;
  page?: number;
  pageSize?: number;
};

export type ReportPerson = { id: string; name: string; avatar_url: string | null };

export type ReportQueueRow = {
  id: string;
  status: ReportStatus;
  target_type: ReportTargetType;
  reason: string;
  created_at: string;
  total: number;
  reporter: ReportPerson;
  reported_user: ReportPerson | null;
  listing: { id: string; title: string | null; thumb: string | null; status: string | null; available: boolean } | null;
  assigned_to: { id: string; name: string } | null;
  target_report_count: number;
};

export async function getReportQueue(f: ReportQueueFilters): Promise<{ rows: ReportQueueRow[]; total: number; error?: string }> {
  const pageSize = f.pageSize ?? 20;
  const { data, error } = await supabase.rpc('admin_report_queue', {
    p_status: f.status || null,
    p_target_type: f.targetType || null,
    p_query: f.query?.trim() || null,
    p_from: f.from || null,
    p_to: f.to || null,
    p_assigned_to: f.assignedTo || null,
    p_limit: pageSize,
    p_offset: (f.page ?? 0) * pageSize,
  });
  if (error) return { rows: [], total: 0, error: error.message };
  const rows = ((data ?? []) as ReportQueueRow[]).map((r) => ({ ...r, total: Number(r.total) }));
  return { rows, total: rows.length ? rows[0].total : 0 };
}

export type ReportWorkspace = {
  report: {
    id: string;
    status: ReportStatus;
    target_type: ReportTargetType;
    target_id: string;
    reason: string;
    details: string | null;
    created_at: string;
    assigned_to: { id: string; name: string } | null;
    reviewed_by: { id: string; name: string } | null;
    resolved_at: string | null;
    resolution_note: string | null;
  };
  reporter: (ReportPerson & { created_at: string; reports_filed: number; reports_actioned: number; reports_dismissed: number }) | null;
  reported_user:
    | (ReportPerson & {
        created_at: string;
        account_status: string;
        suspended_until: string | null;
        verified_at: string | null;
        is_staff: boolean;
        listings_total: number;
        listings_live: number;
        listings_moderated: number;
        warnings_count: number;
        reports_against: number;
        history: { id: string; action: string; reason: string; public_message: string | null; until: string | null; created_at: string; report_id: string | null; actor_name: string }[];
      })
    | null;
  listing: {
    id: string;
    found: boolean;
    state: 'live' | 'moderated' | 'expired' | 'deleted';
    listing: {
      id: string;
      title: string;
      description: string | null;
      price: number;
      currency: string;
      category: string | null;
      subcategory: string | null;
      condition: string | null;
      city: string | null;
      region: string | null;
      negotiable: boolean;
      images: string[] | null;
      attributes: Record<string, unknown> | null;
      status: string;
      views: number;
      favorites_count: number;
      created_at: string;
      updated_at: string;
      user_id: string;
    } | null;
    snapshot: { title?: string; description?: string; price?: number; currency?: string; category?: string; city?: string; condition?: string; status?: string; images?: string[]; listing_created_at?: string } | null;
  } | null;
  review: { id: string; rating: number; comment: string | null; created_at: string; reviewer_id: string; seller_id: string } | null;
  other_reports: { id: string; reason: string; status: ReportStatus; created_at: string; reporter_name: string }[];
  notes: { id: string; note: string; created_at: string; author_name: string }[];
  actions: { event_id: string; action: string; reason: string; public_message: string | null; from_status: string | null; to_status: string | null; until: string | null; created_at: string; actor_name: string; notified: boolean; push_status: string | null }[];
  reporter_notification: { status: string; created_at: string; push_status: string | null } | null;
  audit: { action: string; reason: string | null; created_at: string; admin_name: string; metadata: Record<string, unknown> }[];
};

export async function getReportWorkspace(reportId: string): Promise<{ data?: ReportWorkspace; notFound?: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('admin_report_detail', { p_report_id: reportId });
  if (error) return { error: error.message };
  if (!data) return { notFound: true };
  return { data: data as ReportWorkspace };
}

export async function addReportNote(reportId: string, note: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_add_report_note', { p_report_id: reportId, p_note: note });
  return error ? { error: error.message } : {};
}

export async function updateReportStatus(reportId: string, status: ReportStatus, note?: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_update_report_status', { p_report_id: reportId, p_status: status, p_note: note ?? null });
  return error ? { error: error.message } : {};
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export async function listUsers(search?: string, status?: string | null): Promise<AdminUserSummary[]> {
  let query = supabase
    .from('profiles')
    .select('id, full_name, avatar_url, email, city, created_at, account_status, suspended_until, verified_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (status === 'suspended') query = query.eq('account_status', 'suspended').or(`suspended_until.is.null,suspended_until.gt.${new Date().toISOString()}`);
  else if (status === 'banned') query = query.eq('account_status', 'banned');
  else if (status === 'verified') query = query.not('verified_at', 'is', null);
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
      reviewer: { id: r.reviewer_id, name: names.get(r.reviewer_id) ?? 'SUUQIYE user', avatar: '' },
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
    sellerName: names.get(r.user_id) ?? 'SUUQIYE user',
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

// ---------------------------------------------------------------------------
// Staff roles + moderation dashboard (migrations 0039-0041). Every function
// below is a thin wrapper over a SECURITY DEFINER RPC that re-checks the
// caller's role in Postgres; hiding a button in the UI is never the control.
// ---------------------------------------------------------------------------
import { isStaffRole, type StaffRole } from '@/lib/adminGate';
export type { StaffRole };

export async function getStaffRole(): Promise<StaffRole | null> {
  const { data, error } = await supabase.rpc('staff_role');
  if (error) {
    // Code only — never the message/session. PGRST202 / 42883 = the staff_role() function doesn't exist on this database (migration 0039 not applied).
    console.warn('[admin] staff_role lookup failed', error.code);
    return null;
  }
  if (!data) return null;
  // Anything that isn't exactly a known role is treated as no role.
  return isStaffRole(data) ? data : null;
}

// The role → permission matrix lives in lib/adminGate.ts (pure, unit-tested). Re-exported for existing importers.
export { STAFF_CAN } from '@/lib/adminGate';

export type DashboardCounts = {
  pending_reports: number;
  reviewing_reports: number;
  live_listings: number;
  moderated_listings: number;
  suspended_users: number;
  banned_users: number;
  verified_users: number;
  boosted_now: number;
  open_cases: number;
  awaiting_staff_cases: number;
  pending_appeals: number;
};

export async function getDashboardCounts(): Promise<DashboardCounts | null> {
  const { data, error } = await supabase.rpc('admin_dashboard_counts');
  return error ? null : (data as DashboardCounts);
}

export type AdminListingRow = {
  total: number;
  listing: {
    id: string;
    title: string;
    status: string;
    price: number;
    currency: string;
    category: string | null;
    city: string | null;
    negotiable: boolean;
    images: string[] | null;
    created_at: string;
    boosted_until: string | null;
    user_id: string;
  };
  seller: {
    id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
    account_status: string;
    suspended_until: string | null;
    verified_at: string | null;
    created_at: string;
  };
  report_count: number;
  open_report_count: number;
  last_report_at: string | null;
};

export type AdminListingFilters = {
  status?: string | null;
  reportedOnly?: boolean;
  query?: string;
  sellerId?: string | null;
  sort?: 'newest' | 'most_reported';
  boostedOnly?: boolean;
  page?: number;
  pageSize?: number;
};

export async function listAdminListings(f: AdminListingFilters): Promise<{ rows: AdminListingRow[]; total: number; error?: string }> {
  const pageSize = f.pageSize ?? 25;
  const { data, error } = await supabase.rpc('admin_list_listings', {
    p_status: f.status || null,
    p_reported_only: !!f.reportedOnly,
    p_query: f.query?.trim() || null,
    p_seller_id: f.sellerId || null,
    p_sort: f.sort ?? 'newest',
    p_limit: pageSize,
    p_offset: (f.page ?? 0) * pageSize,
    p_boosted_only: !!f.boostedOnly,
  });
  if (error) return { rows: [], total: 0, error: error.message };
  const rows = (data ?? []) as AdminListingRow[];
  return { rows: rows.map((r) => ({ ...r, total: Number(r.total) })), total: rows.length ? Number(rows[0].total) : 0 };
}

export type AdminListingDetail = {
  listing: Record<string, any> & { id: string; title: string; status: string; images: string[]; user_id: string };
  seller: Record<string, any>;
  reports: { id: string; reporter_id: string; reporter_name: string; reason: string; details: string | null; status: ReportStatus; created_at: string }[];
  history: { id: string; created_at: string; action: string; actor_name: string; reason: string; public_message: string | null; from_status: string | null; to_status: string | null }[];
  boosts: { id: string; starts_at: string; ends_at: string; reason: string; revoked_at: string | null; revoke_reason: string | null }[];
  price_drops: { old_price: number; new_price: number; created_at: string }[];
  appeals: { id: string; status: string; statement: string; decision_message: string | null; created_at: string; decided_at: string | null; case_id: string }[];
};

export async function getAdminListingDetail(id: string): Promise<AdminListingDetail | null> {
  const { data, error } = await supabase.rpc('admin_listing_detail', { p_listing_id: id });
  return error || !data ? null : (data as AdminListingDetail);
}

export async function moderateListing(
  listingId: string,
  action: 'remove' | 'deactivate' | 'restore',
  reason: string,
  message?: string,
  reportId?: string
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_moderate_listing', {
    p_listing_id: listingId,
    p_action: action,
    p_reason: reason,
    p_message: message?.trim() || null,
    p_report_id: reportId ?? null,
  });
  return error ? { error: error.message } : {};
}

export async function moderateUser(
  userId: string,
  action: 'warn' | 'suspend' | 'lift_suspension' | 'ban' | 'unban',
  reason: string,
  opts?: { message?: string; until?: string | null; reportId?: string }
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_moderate_user', {
    p_user_id: userId,
    p_action: action,
    p_reason: reason,
    p_message: opts?.message?.trim() || null,
    p_until: opts?.until ?? null,
    p_report_id: opts?.reportId ?? null,
  });
  return error ? { error: error.message } : {};
}

export async function setVerified(userId: string, verified: boolean, reason: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_set_verified', { p_user_id: userId, p_verified: verified, p_reason: reason });
  return error ? { error: error.message } : {};
}

export async function grantBoost(listingId: string, days: number, reason: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_grant_boost', { p_listing_id: listingId, p_days: days, p_reason: reason });
  return error ? { error: error.message } : {};
}

export async function revokeBoost(boostId: string, reason: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_revoke_boost', { p_boost_id: boostId, p_reason: reason });
  return error ? { error: error.message } : {};
}

export type ModerationEventRow = {
  id: string;
  created_at: string;
  action: string;
  reason: string;
  public_message: string | null;
  until: string | null;
  listing_id: string | null;
  actor_id: string | null;
};

export async function listUserModerationEvents(userId: string): Promise<ModerationEventRow[]> {
  const { data } = await supabase
    .from('moderation_events')
    .select('id, created_at, action, reason, public_message, until, listing_id, actor_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? []) as ModerationEventRow[];
}

export type AdminCaseRow = {
  total: number;
  id: string;
  subject: string;
  category: string;
  status: string;
  user_id: string;
  user_name: string;
  listing_id: string | null;
  created_at: string;
  last_message_at: string;
  appeal_id: string | null;
  appeal_kind: string | null;
  appeal_status: string | null;
  last_snippet: string | null;
};

export async function listAdminCases(status: string | null, page = 0, pageSize = 25): Promise<{ rows: AdminCaseRow[]; total: number; error?: string }> {
  const { data, error } = await supabase.rpc('admin_list_cases', { p_status: status, p_limit: pageSize, p_offset: page * pageSize });
  if (error) return { rows: [], total: 0, error: error.message };
  const rows = (data ?? []) as AdminCaseRow[];
  return { rows: rows.map((r) => ({ ...r, total: Number(r.total) })), total: rows.length ? Number(rows[0].total) : 0 };
}

export type AdminCaseDetail = {
  case: { id: string; subject: string; category: string; status: string; user_id: string; listing_id: string | null; created_at: string };
  user: { id: string; full_name: string | null; email: string | null; account_status: string; suspended_until: string | null; verified_at: string | null; created_at: string } | null;
  listing: { id: string; title: string; status: string; images: string[] | null } | null;
  messages: { id: string; author_kind: 'user' | 'staff' | 'system'; internal: boolean; body: string; created_at: string; staff_name: string | null }[];
  appeal: { id: string; kind: 'listing' | 'suspension' | 'ban'; status: string; statement: string; decision_message: string | null } | null;
  history: { id: string; created_at: string; action: string; reason: string; listing_id: string | null }[];
};

export async function getAdminCaseDetail(id: string): Promise<AdminCaseDetail | null> {
  const { data, error } = await supabase.rpc('admin_case_detail', { p_case_id: id });
  return error || !data ? null : (data as AdminCaseDetail);
}

export async function staffReply(caseId: string, body: string, internal = false): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('staff_support_reply', { p_case_id: caseId, p_body: body, p_internal: internal });
  return error ? { error: error.message } : {};
}

export async function setCaseStatus(caseId: string, status: 'awaiting_staff' | 'awaiting_user' | 'resolved' | 'closed', note?: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('staff_set_case_status', { p_case_id: caseId, p_status: status, p_note: note ?? null });
  return error ? { error: error.message } : {};
}

export async function decideAppeal(appealId: string, decision: 'approve' | 'reject', message?: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('staff_decide_appeal', { p_appeal_id: appealId, p_decision: decision, p_message: message?.trim() || null });
  return error ? { error: error.message } : {};
}
