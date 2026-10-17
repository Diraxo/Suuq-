// Server-side Home / category / city feed (one page per call). Filtering, ordering and paging all happen in
// Postgres via the home_feed() RPC (supabase/migrations/0042) — nothing here fetches "all listings" and filters in
// memory. Throws on any failure so callers show an error state instead of a misleading "no listings".
import { supabase } from '@/lib/supabase';
import { Listing, Profile } from '@/types';
import { getSellerStatsBatch, profileToSeller } from '@/lib/sellerStats';
import { rowToListing, ListingRow } from '@/store/myListings';
import { useListingsStore } from '@/store/listings';
import { registerKnownListingIds } from '@/store/visibility';
import { CurrencyOption } from '@/lib/homeFeed';
import { FeedFetchContext } from '@/lib/pagedFeed';
import { FeedQuery, FeedRpcRow, HOME_PAGE_SIZE, splitFeedPage, toFeedRpcParams } from '@/lib/homeFeedPaging';
import { PageCursor } from '@/lib/searchFilters';
import { SessionPage } from '@/lib/searchSession';

async function hydrate(rows: FeedRpcRow[]): Promise<Listing[]> {
  const userIds = Array.from(new Set(rows.map((r) => (r.listing as unknown as ListingRow).user_id)));
  if (userIds.length === 0) return [];
  const [{ data: profileRows, error: profileError }, statsMap] = await Promise.all([supabase.from('profiles').select('*').in('id', userIds), getSellerStatsBatch(userIds)]);
  // A failed seller lookup must fail the page — never silently drop every listing.
  if (profileError) throw profileError;
  const profiles = new Map<string, Profile>((profileRows ?? []).map((p) => [(p as Profile).id, p as Profile]));
  const items: Listing[] = [];
  for (const r of rows) {
    const row = r.listing as unknown as ListingRow;
    const profile = profiles.get(row.user_id);
    if (!profile) continue;
    const stats = statsMap.get(row.user_id) ?? { listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 };
    items.push(rowToListing(row, profileToSeller(profile, stats)));
  }
  return items;
}

/** One page of a feed. The cursor and the "another page exists" flag come from the rows the server returned. */
export async function fetchFeedPage(query: FeedQuery, cursor: PageCursor | null, ctx: FeedFetchContext, limit: number = HOME_PAGE_SIZE): Promise<SessionPage<Listing>> {
  const { data, error } = await supabase.rpc('home_feed', toFeedRpcParams(query, cursor, limit, ctx.asOf));
  if (error) throw error;
  const page = splitFeedPage((data ?? []) as FeedRpcRow[], limit);
  const items = await hydrate(page.items);
  if (ctx.isCurrent()) {
    // The listing detail screen resolves from the global store: make sure every shown listing can be opened,
    // and let the visibility reconciliation (hidden_listing_ids) check them.
    useListingsStore.getState().mergeFetched(items);
    registerKnownListingIds(items.map((l) => l.id));
  }
  return { items, hasMore: page.hasMore, cursor: page.cursor };
}

/** A handful of newest listings for the empty-state alternatives. */
export async function fetchFeedSample(query: FeedQuery, limit: number): Promise<Listing[]> {
  const { data, error } = await supabase.rpc('home_feed', toFeedRpcParams(query, null, limit));
  if (error) throw error;
  return hydrate(splitFeedPage((data ?? []) as FeedRpcRow[], limit).items);
}

/** The Price tab's currency choices for the browsed set (category + place), most common first. */
export async function fetchCurrencyOptions(categories: string[] | null, scopeId: string | null): Promise<CurrencyOption[]> {
  const { data, error } = await supabase.rpc('home_feed_currencies', { p_categories: categories && categories.length ? categories : null, p_scope_id: scopeId });
  if (error) throw error;
  return ((data ?? []) as { code: string; n: number | string }[]).map((r) => ({ code: r.code, count: Number(r.n) }));
}
