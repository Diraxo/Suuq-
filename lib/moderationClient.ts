// Pure helpers shared by the seller-facing moderation UI and the realtime sync — no React or platform imports,
// so the identical file lives at web/src/lib/moderationClient.ts (keep the copies in sync;
// tests/moderation.test.ts fails if they drift).

export type AccountStatus = 'active' | 'suspended' | 'banned';
export type AccountState = { status: AccountStatus; until: string | null };
export const ACTIVE_ACCOUNT: AccountState = { status: 'active', until: null };

/**
 * What the account can do RIGHT NOW. A suspension whose end date has passed is already over — the database
 * applies the same rule (account_effective_status), so the client never shows a stale restriction.
 */
export function effectiveAccountState(
  raw: { account_status?: string | null; suspended_until?: string | null } | null | undefined,
  now: Date = new Date()
): AccountState {
  const status = raw?.account_status;
  if (status === 'banned') return { status: 'banned', until: null };
  if (status === 'suspended') {
    const until = raw?.suspended_until ?? null;
    if (until && new Date(until).getTime() <= now.getTime()) return ACTIVE_ACCOUNT;
    return { status: 'suspended', until };
  }
  return ACTIVE_ACCOUNT;
}

export function isRestricted(s: AccountState): boolean {
  return s.status !== 'active';
}

// ---- listing visibility (real-time) -----------------------------------------------------------------------
export const VISIBILITY_TOPIC = 'listings:visibility';
export const VISIBILITY_EVENT = 'listing_visibility';

export type VisibilityEvent = { id: string; visible: boolean; at: number };

/** Validates a broadcast payload; anything malformed is ignored rather than trusted. */
export function parseVisibilityPayload(p: unknown): VisibilityEvent | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(o.id)) return null;
  if (typeof o.visible !== 'boolean') return null;
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0;
  return { id: o.id, visible: o.visible, at };
}

/**
 * Newest-wins per listing id: a duplicate (same timestamp) or out-of-order (older) event is rejected, so a
 * reconnect that replays events, or two events arriving swapped, can never flip a listing back to a stale state.
 */
export function createVisibilityGate() {
  const last = new Map<string, number>();
  return {
    accept(e: VisibilityEvent): boolean {
      const prev = last.get(e.id);
      if (prev !== undefined && e.at <= prev) return false;
      last.set(e.id, e.at);
      return true;
    },
  };
}

/** Chunks ids for hidden_listing_ids(), which caps its input (server side) at 200. */
export function chunkIds(ids: string[], size = 200): string[][] {
  const out: string[][] = [];
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}

// ---- notices / support -------------------------------------------------------------------------------------
export type NoticeKind =
  | 'listing_removed' | 'listing_deactivated' | 'listing_restored' | 'warning' | 'suspension' | 'suspension_lifted'
  | 'suspension_expired' | 'ban' | 'unban' | 'appeal_approved' | 'appeal_rejected';

export type ModerationNotice = {
  id: string;
  kind: NoticeKind | string;
  title: string;
  body: string;
  fromLabel: string;
  listingId: string | null;
  appealable: boolean;
  expiresAt: string | null;
  readAt: string | null;
  createdAt: string;
};

export type SupportCaseStatus = 'awaiting_staff' | 'awaiting_user' | 'resolved' | 'closed';
export type SupportCase = {
  id: string;
  subject: string;
  category: string;
  status: SupportCaseStatus;
  listingId: string | null;
  lastMessageAt: string;
  createdAt: string;
};
export type SupportMessage = { id: string; authorKind: 'user' | 'staff' | 'system'; body: string; createdAt: string };

/** The only name a seller ever sees for staff. */
export const SUPPORT_TEAM_LABEL = 'Suuqiye Support Team';

/** Which kinds of notice can start an appeal, and for what. */
export function appealKindFor(kind: string): 'listing' | 'suspension' | 'ban' | null {
  if (kind === 'listing_removed' || kind === 'listing_deactivated') return 'listing';
  if (kind === 'suspension') return 'suspension';
  if (kind === 'ban') return 'ban';
  return null;
}

/** Merges a pushed notice into a list: newest first, no duplicates. */
export function mergeNotice(list: ModerationNotice[], n: ModerationNotice): ModerationNotice[] {
  const rest = list.filter((x) => x.id !== n.id);
  return [n, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function rowToNotice(r: Record<string, any>): ModerationNotice {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    fromLabel: r.from_label ?? SUPPORT_TEAM_LABEL,
    listingId: r.listing_id ?? null,
    appealable: !!r.appealable,
    expiresAt: r.expires_at ?? null,
    readAt: r.read_at ?? null,
    createdAt: r.created_at,
  };
}

export function rowToCase(r: Record<string, any>): SupportCase {
  return { id: r.id, subject: r.subject, category: r.category, status: r.status, listingId: r.listing_id ?? null, lastMessageAt: r.last_message_at, createdAt: r.created_at };
}

export function rowToMessage(r: Record<string, any>): SupportMessage {
  return { id: r.id, authorKind: r.author_kind, body: r.body, createdAt: r.created_at };
}

/** A reply can be added unless the case is closed, or resolved for more than 14 days (the server enforces it). */
export function canReply(c: Pick<SupportCase, 'status'> & { resolvedAt?: string | null }, now: Date = new Date()): boolean {
  if (c.status === 'closed') return false;
  if (c.status === 'resolved' && c.resolvedAt) return now.getTime() - new Date(c.resolvedAt).getTime() <= 14 * 86_400_000;
  return true;
}
