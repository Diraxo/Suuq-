// Server-side Home / category feed (one page per call) — the same home_feed() RPC (supabase/migrations/0042) and the
// same request shaping as mobile (lib/homeFeedPaging.ts is an identical copy). Filtering, ordering and paging all
// happen in Postgres; nothing fetches "all listings". Throws on failure so the page shows an error state instead of
// a misleading "no listings".
import { supabase } from '@/lib/supabase';
import { Listing } from '@/lib/types';
import { hydrateSellers, ListingRow } from './listings';
import { CurrencyOption } from '@/lib/homeFeed';
import { FeedFetchContext } from '@/lib/pagedFeed';
import { FeedQuery, FeedRpcRow, HOME_PAGE_SIZE, splitFeedPage, toFeedRpcParams } from '@/lib/homeFeedPaging';
import { PageCursor } from '@/lib/searchFilters';
import { SessionPage } from '@/lib/searchSession';
import { registerKnownListingIds } from '@/store/visibility';

/** One page of a feed. The cursor and the "another page exists" flag come from the rows the server returned. */
export async function fetchFeedPage(query: FeedQuery, cursor: PageCursor | null, ctx: FeedFetchContext, limit: number = HOME_PAGE_SIZE): Promise<SessionPage<Listing>> {
  const { data, error } = await supabase.rpc('home_feed', toFeedRpcParams(query, cursor, limit, ctx.asOf));
  if (error) throw error;
  const page = splitFeedPage((data ?? []) as FeedRpcRow[], limit);
  // strict: a failed seller lookup fails the page instead of silently dropping every listing.
  const items = await hydrateSellers(page.items.map((r) => r.listing as unknown as ListingRow), true);
  // Shown listings are checked against the database after a reconnect (hidden_listing_ids).
  if (ctx.isCurrent()) registerKnownListingIds(items.map((l) => l.id));
  return { items, hasMore: page.hasMore, cursor: page.cursor };
}

/** A handful of newest listings for the empty-state alternatives. */
export async function fetchFeedSample(query: FeedQuery, limit: number): Promise<Listing[]> {
  const { data, error } = await supabase.rpc('home_feed', toFeedRpcParams(query, null, limit));
  if (error) throw error;
  return hydrateSellers(splitFeedPage((data ?? []) as FeedRpcRow[], limit).items.map((r) => r.listing as unknown as ListingRow), true);
}

/** The Price tab's currency choices for the browsed set (category + place), most common first. */
export async function fetchCurrencyOptions(categories: string[] | null, scopeId: string | null): Promise<CurrencyOption[]> {
  const { data, error } = await supabase.rpc('home_feed_currencies', { p_categories: categories && categories.length ? categories : null, p_scope_id: scopeId });
  if (error) throw error;
  return ((data ?? []) as { code: string; n: number | string }[]).map((r) => ({ code: r.code, count: Number(r.n) }));
}
