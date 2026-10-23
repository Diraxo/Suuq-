// Search filter semantics, request shaping and empty-state recovery — plain TypeScript with no React or
// platform imports, so the identical file lives at web/src/lib/searchFilters.ts (keep the two copies in sync;
// tests/searchFilters.test.ts fails if they drift). The SQL source of truth is supabase/migrations/0038:
// tests/searchFilters.test.ts and supabase/tests/discovery.test.mjs prove both agree.

/** A price decrease counts as "Price reduced" for this many days (mirrors price_reduced_window() in 0038). */
export const PRICE_REDUCED_DAYS = 14;
/** Marketplace-day boundaries (posted today / boost day grants) use this zone: UTC+3, no daylight saving. */
export const MARKETPLACE_TZ = 'Africa/Addis_Ababa';
const MARKETPLACE_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
export const SEARCH_PAGE_SIZE = 24;
export const SEARCH_QUERY_MAX = 100;
export const SEARCH_DEBOUNCE_MS = 300;

export const FILTER_IDS = ['verified', 'boostedToday', 'priceReduced', 'negotiable', 'postedToday'] as const;
export type FilterId = (typeof FILTER_IDS)[number];
/** The chips are mutually exclusive: at most one is ON (all start OFF). The record shape stays per-filter so the RPC/SQL contract is unchanged. */
export type FilterState = Record<FilterId, boolean>;

export const NO_FILTERS: FilterState = { verified: false, boostedToday: false, priceReduced: false, negotiable: false, postedToday: false };

/** Selecting a chip turns every other one off; selecting the active chip again clears it. */
export function toggleFilter(state: FilterState, id: FilterId): FilterState {
  return state[id] ? NO_FILTERS : { ...NO_FILTERS, [id]: true };
}
export function activeFilterIds(state: FilterState): FilterId[] {
  return FILTER_IDS.filter((id) => state[id]);
}
export function hasActiveFilters(state: FilterState): boolean {
  return activeFilterIds(state).length > 0;
}

export type SearchInput = {
  query: string;
  category?: string | null;
  /** Approved location id (country/region/city); listings in it or below it match. */
  scopeId?: string | null;
  filters: FilterState;
};
/** Position after the last row of a page. `rank` is used only by the Home feed (lib/homeFeedPaging.ts); search orders by (createdAt, id) alone. */
export type PageCursor = { createdAt: string; id: string; rank?: number };

export function normalizeQueryText(q: string): string {
  return q.trim().slice(0, SEARCH_QUERY_MAX);
}

/** Arguments for the search_listings() RPC. One fetch = one page of at most `limit` rows (+1 to detect more). */
export function toRpcParams(input: SearchInput, cursor?: PageCursor | null, limit: number = SEARCH_PAGE_SIZE) {
  const q = normalizeQueryText(input.query);
  return {
    p_query: q || null,
    p_category: input.category || null,
    p_scope_id: input.scopeId || null,
    p_verified: input.filters.verified,
    p_boosted_today: input.filters.boostedToday,
    p_price_reduced: input.filters.priceReduced,
    p_negotiable: input.filters.negotiable,
    p_posted_today: input.filters.postedToday,
    p_limit: limit,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
  };
}

/** Stable identity of a search (everything except the page) — used to drop responses to superseded searches. */
export function searchKey(input: SearchInput): string {
  return JSON.stringify([normalizeQueryText(input.query), input.category ?? null, input.scopeId ?? null, activeFilterIds(input.filters)]);
}

export type SearchRpcRow = {
  listing: { id: string; created_at: string } & Record<string, unknown>;
  is_boosted: boolean;
  price_reduced: boolean;
  seller_verified: boolean;
};

/** The RPC returns limit+1 rows; the extra row only signals that another page exists. */
export function splitPage<T extends { listing: { id: string; created_at: string } }>(rows: T[], limit: number = SEARCH_PAGE_SIZE): { items: T[]; hasMore: boolean; cursor: PageCursor | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, hasMore, cursor: hasMore && last ? { createdAt: last.listing.created_at, id: last.listing.id } : null };
}

/** Appends a page, ignoring ids already shown (a realtime refresh or retry can overlap pages). */
export function mergePage<T extends { listing: { id: string } }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map((r) => r.listing.id));
  return [...existing, ...incoming.filter((r) => !seen.has(r.listing.id))];
}

// ---- reference semantics (same rules as search_listings(); used for parity tests and in-memory callers) ----

export type FilterFacts = {
  sellerVerifiedAt: string | null;
  boostedUntil: string | null;
  lastPriceDropAt: string | null;
  lastPriceDropFrom: number | null;
  price: number;
  negotiable: boolean;
  createdAt: string;
};

/** Start (UTC instant) of the marketplace day containing `now`. */
export function marketplaceDayStart(now: Date): Date {
  const local = now.getTime() + MARKETPLACE_UTC_OFFSET_MS;
  const dayStartLocal = Math.floor(local / 86_400_000) * 86_400_000;
  return new Date(dayStartLocal - MARKETPLACE_UTC_OFFSET_MS);
}

export function isPriceReduced(f: Pick<FilterFacts, 'lastPriceDropAt' | 'lastPriceDropFrom' | 'price'>, now: Date): boolean {
  if (!f.lastPriceDropAt || f.lastPriceDropFrom == null) return false;
  const age = now.getTime() - new Date(f.lastPriceDropAt).getTime();
  return age <= PRICE_REDUCED_DAYS * 86_400_000 && f.price < f.lastPriceDropFrom;
}
export function isBoostedNow(f: Pick<FilterFacts, 'boostedUntil'>, now: Date): boolean {
  return !!f.boostedUntil && new Date(f.boostedUntil).getTime() > now.getTime();
}

export function matchesFilters(f: FilterFacts, filters: FilterState, now: Date): boolean {
  if (filters.verified && !f.sellerVerifiedAt) return false;
  if (filters.boostedToday && !isBoostedNow(f, now)) return false;
  if (filters.priceReduced && !isPriceReduced(f, now)) return false;
  if (filters.negotiable && !f.negotiable) return false;
  if (filters.postedToday && new Date(f.createdAt).getTime() < marketplaceDayStart(now).getTime()) return false;
  return true;
}

// ---- empty state ----------------------------------------------------------------------------------------

export type RecoveryAction = 'clearFilters' | 'clearSearch' | 'clearCategory' | 'clearLocation' | 'saveSearch';

/** Which recovery actions make sense for a search that returned nothing. Order = most useful first. */
export function recoveryActions(input: SearchInput): RecoveryAction[] {
  const out: RecoveryAction[] = [];
  if (hasActiveFilters(input.filters)) out.push('clearFilters');
  if (normalizeQueryText(input.query)) out.push('clearSearch');
  if (input.category) out.push('clearCategory');
  if (input.scopeId) out.push('clearLocation');
  // Saving only makes sense for something the user actually searched for; filters/category alone are just browsing.
  if (normalizeQueryText(input.query)) out.push('saveSearch');
  return out;
}

/**
 * Real, eligible recommendations for an empty result: the newest eligible listings, in the same category when
 * the search had one (falling back to everything), never the filters/query that produced the empty set.
 */
export function recommendationSearches(input: SearchInput): SearchInput[] {
  const list: SearchInput[] = [];
  if (input.category) list.push({ query: '', category: input.category, scopeId: input.scopeId ?? null, filters: NO_FILTERS });
  list.push({ query: '', category: null, scopeId: input.scopeId ?? null, filters: NO_FILTERS });
  if (input.scopeId) list.push({ query: '', category: null, scopeId: null, filters: NO_FILTERS });
  return list;
}
