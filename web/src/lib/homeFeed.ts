// The single definition of how Home filters, sorts and falls back — pure, no
// platform imports, so the identical file lives at web/src/lib/homeFeed.ts
// (the web app is a separate package) — keep the two copies in sync
// (scripts/run-tests.js fails if they drift).
import { LocIndex, LocNode, ancestors, childrenOf, countryOf, findByName, hasChildren, isWithin, Lang, norm } from './locationTree';

export const DISCOVERY_TABS = ['For You', 'Nearby', 'Latest', 'Trending', 'Price', 'Price Drops'] as const;
export type DiscoveryTab = (typeof DISCOVERY_TABS)[number];
export type PriceOrder = 'asc' | 'desc';

/** The fields Home reads from a listing — both platforms' Listing types satisfy this. */
export type FeedListing = {
  id: string;
  price: number;
  currency: string;
  category: string;
  city: string;
  createdAt?: number;
  views: number;
  favoritesCount: number;
};

export type FeedCategory = { id: string; name: string };

const DAY_MS = 86_400_000;
/** Listings that already have favorites/views stay competitive for about a week before newer ones overtake them. */
export const TRENDING_HALF_LIFE_DAYS = 7;
export const FALLBACK_LIMIT = 8;

/** Category match on the stable id, tolerating legacy rows that stored the display name. */
export function categoryMatches(value: string | null | undefined, cat: FeedCategory): boolean {
  if (!value) return false;
  const v = norm(value);
  return v === norm(cat.id) || v === norm(cat.name);
}

/**
 * Trending, from the only public activity signals that exist: running view
 * count and favorites (a save is a stronger signal than a view, ×5), decayed by
 * listing age so a listing that was popular months ago stops outranking fresh
 * interest. No sales/inquiry signal is public, so none is used.
 */
export function trendingScore(l: FeedListing, now: number): number {
  const engagement = Math.max(0, l.views) + Math.max(0, l.favoritesCount) * 5;
  const ageDays = Math.max(0, (now - (l.createdAt ?? now)) / DAY_MS);
  return engagement / (1 + ageDays / TRENDING_HALF_LIFE_DAYS);
}

const byNewest = (a: FeedListing, b: FeedListing) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function isValidPrice(p: number): boolean {
  return Number.isFinite(p) && p > 0;
}

export function sortNewest<T extends FeedListing>(list: T[]): T[] {
  return [...list].sort(byNewest);
}

export function sortTrending<T extends FeedListing>(list: T[], now: number): T[] {
  return [...list].sort((a, b) => trendingScore(b, now) - trendingScore(a, now) || byNewest(a, b));
}

/** Numeric price order; listings without a usable price always go last, in newest-first order. */
export function sortPrice<T extends FeedListing>(list: T[], order: PriceOrder): T[] {
  return [...list].sort((a, b) => {
    const av = isValidPrice(a.price);
    const bv = isValidPrice(b.price);
    if (av !== bv) return av ? -1 : 1;
    if (av && a.price !== b.price) return order === 'asc' ? a.price - b.price : b.price - a.price;
    return byNewest(a, b);
  });
}

export type CurrencyOption = { code: string; count: number };

export function currencyOptions(list: FeedListing[]): CurrencyOption[] {
  const counts = new Map<string, number>();
  for (const l of list) {
    const code = (l.currency || 'ETB').toUpperCase();
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1));
}

/** Nearness of a listing to an anchor place by directory hierarchy: 0 same place, 1 same region, 2 same country, 3 elsewhere/unknown. */
export function nearbyRank(index: LocIndex, listingCity: string, anchorId: string): number {
  const node = findByName(index, listingCity);
  const anchor = index.byId.get(anchorId);
  if (!node || !anchor) return 3;
  if (node.id === anchor.id) return 0;
  const region = anchor.kind === 'region' ? anchor : ancestors(index, anchor.id).find((n) => n.kind === 'region');
  if (region && isWithin(index, node.id, region.id)) return 1;
  const country = countryOf(index, anchor.id);
  if (country && isWithin(index, node.id, country.id)) return 2;
  return 3;
}

/**
 * The place Nearby is measured from. A chosen scope is the place being browsed; the user's home place only
 * orders results inside it (when it sits inside it). null = no place known yet.
 */
export function nearbyAnchorFor(index: LocIndex, scopeNode: LocNode | null, homePlaceId: string | null): LocNode | null {
  const home = homePlaceId ? index.byId.get(homePlaceId) ?? null : null;
  return scopeNode ? (home && isWithin(index, home.id, scopeNode.id) ? home : scopeNode) : home;
}

export type FallbackKind =
  /** Wider place (region/country) that still matches the chosen category. */
  | 'wider-area'
  /** Other categories (in the same place when one is chosen). */
  | 'other-categories'
  /** Anything on the marketplace. */
  | 'marketplace';

export type HomeFeedInput<T extends FeedListing> = {
  listings: T[];
  index: LocIndex;
  scopeId: string | null;
  category: FeedCategory | null;
  tab: DiscoveryTab;
  priceOrder: PriceOrder;
  /** Chosen currency for the Price tab; null/unknown → the most common one. */
  currency: string | null;
  priceDropAt: Record<string, number>;
  /** The user's home place (their profile city), used as the Nearby anchor. */
  homePlaceId: string | null;
  now: number;
};

export type HomeFeed<T extends FeedListing> = {
  /** Listings that strictly match every active filter, in the active sort order. */
  items: T[];
  /** Nearby needs a place to be near; none is known yet. */
  needsLocation: boolean;
  /** Place Nearby is measured from, when there is one. */
  nearbyAnchor: LocNode | null;
  /** Price tab only: the currency being compared and the choices. */
  price: { currency: string; options: CurrencyOption[]; hiddenOther: number } | null;
  /** Only when `items` is empty: separately labelled alternatives. */
  fallback: { kind: FallbackKind; place: LocNode | null; items: T[] } | null;
};

function inScope<T extends FeedListing>(index: LocIndex, list: T[], placeId: string): T[] {
  return list.filter((l) => {
    const n = findByName(index, l.city);
    return !!n && isWithin(index, n.id, placeId);
  });
}

export function buildHomeFeed<T extends FeedListing>(input: HomeFeedInput<T>): HomeFeed<T> {
  const { listings, index, category, tab, now } = input;
  const matchCat = (l: T) => !category || categoryMatches(l.category, category);
  // A saved scope that is not in the (approved) directory — removed, or the
  // directory has not loaded yet — is treated as "All Locations" rather than
  // filtering every listing out; the strip shows the same thing.
  const scopeNode = input.scopeId ? index.byId.get(input.scopeId) ?? null : null;
  const scopeId = scopeNode ? scopeNode.id : null;

  let base = scopeId ? inScope(index, listings, scopeId) : listings;
  base = base.filter(matchCat);

  let items: T[];
  let needsLocation = false;
  let nearbyAnchor: LocNode | null = null;
  let price: HomeFeed<T>['price'] = null;

  switch (tab) {
    case 'Latest':
      items = sortNewest(base);
      break;
    case 'Trending':
      items = sortTrending(base, now);
      break;
    case 'Price': {
      const options = currencyOptions(base);
      const currency = options.find((o) => o.code === (input.currency ?? '').toUpperCase())?.code ?? options[0]?.code ?? (input.currency ?? 'ETB').toUpperCase();
      const same = base.filter((l) => (l.currency || 'ETB').toUpperCase() === currency);
      items = sortPrice(same, input.priceOrder);
      price = { currency, options, hiddenOther: base.length - same.length };
      break;
    }
    case 'Price Drops':
      items = base.filter((l) => l.id in input.priceDropAt).sort((a, b) => (input.priceDropAt[b.id] ?? 0) - (input.priceDropAt[a.id] ?? 0) || byNewest(a, b));
      break;
    case 'Nearby': {
      const anchor = nearbyAnchorFor(index, scopeNode, input.homePlaceId);
      nearbyAnchor = anchor;
      if (!anchor) {
        needsLocation = true;
        items = [];
        break;
      }
      const ranked = base.map((l) => ({ l, r: nearbyRank(index, l.city, anchor.id) }));
      // With no chosen scope, "near me" stops at the home country.
      items = ranked
        .filter((x) => scopeNode || x.r <= 2)
        .sort((a, b) => a.r - b.r || byNewest(a.l, b.l))
        .map((x) => x.l);
      break;
    }
    default:
      items = sortNewest(base);
  }

  let fallback: HomeFeed<T>['fallback'] = null;
  if (items.length === 0 && !needsLocation) {
    const take = (list: T[]) => sortNewest(list).slice(0, FALLBACK_LIMIT);
    // 1) wider places that still match the category: region, then country.
    if (scopeNode) {
      for (const place of ancestors(index, scopeNode.id).reverse()) {
        const found = inScope(index, listings, place.id).filter(matchCat);
        if (found.length) {
          fallback = { kind: 'wider-area', place, items: take(found) };
          break;
        }
      }
    }
    // 2) other categories — in the same place when one is chosen.
    if (!fallback && category) {
      const found = scopeNode ? inScope(index, listings, scopeNode.id) : listings;
      if (found.length) fallback = { kind: 'other-categories', place: scopeNode, items: take(found) };
    }
    // 3) the broader marketplace.
    if (!fallback && listings.length) fallback = { kind: 'marketplace', place: null, items: take(listings) };
  }

  return { items, needsLocation, nearbyAnchor, price, fallback };
}

// ── Location selector (the horizontal "Explore by location" strip) ──────────

export type ScopeOption = { id: string | null; node: LocNode | null; isAll: boolean };
export type ScopeSelector = {
  /** The place whose children the strip lists (null → countries). */
  parent: LocNode | null;
  options: ScopeOption[];
  activeIndex: number;
};

/**
 * What the strip shows for the current scope: "All Locations"/"All of X" first,
 * then X's children. A leaf (city) keeps showing its siblings so switching is
 * one tap.
 */
export function scopeSelector(index: LocIndex, scopeId: string | null, lang: Lang): ScopeSelector {
  const node = scopeId ? index.byId.get(scopeId) : undefined;
  const parent = node ? (hasChildren(index, node.id) ? node : node.parentId ? index.byId.get(node.parentId) ?? null : null) : null;
  const kids = parent ? childrenOf(index, parent.id, lang) : childrenOf(index, null, lang).filter((c) => hasChildren(index, c.id));
  const options: ScopeOption[] = [
    { id: parent ? parent.id : null, node: parent, isAll: true },
    ...kids.map((n) => ({ id: n.id as string | null, node: n, isAll: false })),
  ];
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.id === scopeId)
  );
  return { parent, options, activeIndex };
}

/** Where the strip should scroll after the scope changed: the start (the "All" option) unless a specific child is selected, then that child. */
export function scopeScrollTarget(sel: ScopeSelector): { index: number } {
  return { index: sel.options[sel.activeIndex]?.isAll ? 0 : sel.activeIndex };
}

/**
 * The always-visible "way back" for the current scope: the parent place, or
 * All Locations (node null) from a country. null when nothing is selected (or
 * the scope is unknown), i.e. there is nowhere to go back to.
 */
export function scopeBack(index: LocIndex, scopeId: string | null): { id: string | null; node: LocNode | null } | null {
  const node = scopeId ? index.byId.get(scopeId) : undefined;
  if (!node) return null;
  const parent = node.parentId ? index.byId.get(node.parentId) ?? null : null;
  return { id: parent ? parent.id : null, node: parent };
}
