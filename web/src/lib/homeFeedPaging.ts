// Request shaping for the paginated Home / category / city feeds — pure TypeScript with no React or platform
// imports, so the identical file lives at web/src/lib/homeFeedPaging.ts (keep the copies in sync;
// tests/homeFeedPaging.test.ts fails if they drift). The SQL source of truth is supabase/migrations/0042
// (home_feed); lib/homeFeed.ts stays the reference for the rules and supabase/tests/homefeed.test.mjs proves the
// two return the same listings in the same order.
import { LocIndex, LocNode, ancestors } from './locationTree';
import { CurrencyOption, DiscoveryTab, FALLBACK_LIMIT, FallbackKind, FeedCategory, PriceOrder, nearbyAnchorFor } from './homeFeed';
import { PageCursor } from './searchFilters';

export const HOME_PAGE_SIZE = 24;
/** The feed's own tab names (what home_feed() accepts). "For You" has no separate ranking signal, so it is Latest. */
export type FeedTab = 'latest' | 'nearby' | 'trending' | 'price' | 'price_drops';

export function feedTabFor(tab: DiscoveryTab): FeedTab {
  switch (tab) {
    case 'Nearby':
      return 'nearby';
    case 'Trending':
      return 'trending';
    case 'Price':
      return 'price';
    case 'Price Drops':
      return 'price_drops';
    default:
      return 'latest';
  }
}

/** Everything that decides WHICH listings a feed shows and in what order (never the page). */
export type FeedQuery = {
  tab: FeedTab;
  /** Stored category values to match (the stable id, plus the display name for legacy rows). null = every category. */
  categories: string[] | null;
  subcategory: string | null;
  /** Approved location id; listings in it or below it match. */
  scopeId: string | null;
  /** Exact city name (the city screen). */
  city: string | null;
  /** Nearby only: the place proximity is measured from. */
  anchorId: string | null;
  /** Price only: the single currency being compared. */
  currency: string | null;
  /** Price only. */
  priceOrder: PriceOrder;
};

export const BASE_QUERY: FeedQuery = { tab: 'latest', categories: null, subcategory: null, scopeId: null, city: null, anchorId: null, currency: null, priceOrder: 'asc' };

/** Stable identity of a feed (everything except the page) — used to drop responses to superseded feeds. */
export function feedKey(q: FeedQuery): string {
  return JSON.stringify([q.tab, q.categories, q.subcategory, q.scopeId, q.city, q.anchorId, q.currency, q.priceOrder]);
}

export function categoryValues(category: FeedCategory | null): string[] | null {
  if (!category) return null;
  return category.name && category.name !== category.id ? [category.id, category.name] : [category.id];
}

/** Arguments for the home_feed() RPC. `asOf` (ms) is the frozen "now" Trending's age decay is measured at. */
export function toFeedRpcParams(q: FeedQuery, cursor: PageCursor | null, limit: number = HOME_PAGE_SIZE, asOf?: number) {
  return {
    p_tab: q.tab,
    p_categories: q.categories && q.categories.length ? q.categories : null,
    p_subcategory: q.subcategory || null,
    p_scope_id: q.scopeId || null,
    p_city: q.city || null,
    p_anchor_id: q.tab === 'nearby' ? q.anchorId : null,
    p_currency: q.tab === 'price' ? q.currency : null,
    p_price_order: q.priceOrder,
    p_limit: limit,
    p_now: q.tab === 'trending' && asOf != null ? new Date(asOf).toISOString() : null,
    p_cursor_rank: cursor?.rank ?? null,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
  };
}

export type FeedRpcRow = { listing: { id: string; created_at: string } & Record<string, unknown>; sort_rank: number };

/**
 * The RPC returns limit+1 rows; the extra row only signals that another page exists. The cursor is the last row
 * that IS shown, with `createdAt` kept as the server's own string (never round-tripped through Date, which would
 * drop microseconds and make the next page repeat or skip rows).
 */
export function splitFeedPage<T extends FeedRpcRow>(rows: T[], limit: number = HOME_PAGE_SIZE): { items: T[]; hasMore: boolean; cursor: PageCursor | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, hasMore, cursor: hasMore && last ? { rank: Number(last.sort_rank), createdAt: last.listing.created_at, id: last.listing.id } : null };
}

// ── Home query from the UI selections ───────────────────────────────────────

export type PriceMeta = { currency: string; options: CurrencyOption[]; hiddenOther: number };

/** The chosen currency when it is on offer, else the most common one (ties: code order) — same rule as buildHomeFeed. */
export function resolvePriceCurrency(options: CurrencyOption[], requested: string | null): string {
  return options.find((o) => o.code === (requested ?? '').toUpperCase())?.code ?? options[0]?.code ?? (requested ?? 'ETB').toUpperCase();
}

export function priceMeta(options: CurrencyOption[], requested: string | null): PriceMeta {
  const currency = resolvePriceCurrency(options, requested);
  const total = options.reduce((n, o) => n + o.count, 0);
  const same = options.find((o) => o.code === currency)?.count ?? 0;
  return { currency, options, hiddenOther: total - same };
}

export type HomeQueryInput = {
  index: LocIndex;
  scopeId: string | null;
  category: FeedCategory | null;
  tab: DiscoveryTab;
  priceOrder: PriceOrder;
  /** The user's chosen Price currency (null = most common). */
  currency: string | null;
  /** The user's home place (profile city) — Nearby's anchor. */
  homePlaceId: string | null;
  /** Price tab only: the currencies present in the browsed set; null until they have loaded. */
  priceOptions: CurrencyOption[] | null;
};

export type HomeQuery = {
  /** null = nothing to fetch right now (Nearby has no place yet, or the Price currencies have not loaded). */
  query: FeedQuery | null;
  needsLocation: boolean;
  nearbyAnchor: LocNode | null;
  price: PriceMeta | null;
  /** The scope as the directory resolves it (a removed/unknown saved scope counts as "All Locations"). */
  scopeNode: LocNode | null;
};

export function buildHomeQuery(input: HomeQueryInput): HomeQuery {
  const scopeNode = input.scopeId ? input.index.byId.get(input.scopeId) ?? null : null;
  const feedTab = feedTabFor(input.tab);
  const query: FeedQuery = {
    ...BASE_QUERY,
    tab: feedTab,
    categories: categoryValues(input.category),
    scopeId: scopeNode ? scopeNode.id : null,
  };
  if (feedTab === 'nearby') {
    const anchor = nearbyAnchorFor(input.index, scopeNode, input.homePlaceId);
    if (!anchor) return { query: null, needsLocation: true, nearbyAnchor: null, price: null, scopeNode };
    return { query: { ...query, anchorId: anchor.id }, needsLocation: false, nearbyAnchor: anchor, price: null, scopeNode };
  }
  if (feedTab === 'price') {
    if (!input.priceOptions) return { query: null, needsLocation: false, nearbyAnchor: null, price: null, scopeNode };
    const price = priceMeta(input.priceOptions, input.currency);
    return { query: { ...query, currency: price.currency, priceOrder: input.priceOrder }, needsLocation: false, nearbyAnchor: null, price, scopeNode };
  }
  return { query, needsLocation: false, nearbyAnchor: null, price: null, scopeNode };
}

// ── Empty-state alternatives (same order as buildHomeFeed's fallback) ───────

export type FallbackStep = { kind: FallbackKind; place: LocNode | null; query: FeedQuery };

/**
 * Where to look, in order, when the selection itself has no listings: a wider place that still matches the
 * category (nearest first), then other categories (in the same place when one is chosen), then the whole
 * marketplace. The first step that returns anything is shown, newest first, FALLBACK_LIMIT at most.
 */
export function fallbackPlan(index: LocIndex, scopeId: string | null, category: FeedCategory | null): FallbackStep[] {
  const scopeNode = scopeId ? index.byId.get(scopeId) ?? null : null;
  const steps: FallbackStep[] = [];
  if (scopeNode) {
    for (const place of ancestors(index, scopeNode.id).reverse()) {
      steps.push({ kind: 'wider-area', place, query: { ...BASE_QUERY, categories: categoryValues(category), scopeId: place.id } });
    }
  }
  if (category) steps.push({ kind: 'other-categories', place: scopeNode, query: { ...BASE_QUERY, scopeId: scopeNode ? scopeNode.id : null } });
  steps.push({ kind: 'marketplace', place: null, query: { ...BASE_QUERY } });
  return steps;
}

export async function runFallback<T>(
  steps: FallbackStep[],
  fetchStep: (query: FeedQuery, limit: number) => Promise<T[]>,
  isCurrent: () => boolean = () => true
): Promise<{ kind: FallbackKind; place: LocNode | null; items: T[] } | null> {
  for (const step of steps) {
    const items = await fetchStep(step.query, FALLBACK_LIMIT);
    if (!isCurrent()) return null;
    if (items.length) return { kind: step.kind, place: step.place, items };
  }
  return null;
}
