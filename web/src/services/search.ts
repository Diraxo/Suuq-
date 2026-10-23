// Server-side search (one page per call). Filtering, ordering and paging all happen in Postgres via the
// search_listings() RPC (supabase/migrations/0038) — the same function and the same filter semantics as mobile
// (lib/searchFilters.ts is an identical copy). Nothing fetches "all listings" and filters in memory.
// Throws on failure so the page can show an error instead of a misleading "no results".
import { supabase } from '@/lib/supabase';
import { Listing } from '@/lib/types';
import { hydrateSellers, ListingRow } from './listings';
import { PageCursor, SearchInput, SearchRpcRow, SEARCH_PAGE_SIZE, splitPage, toRpcParams } from '@/lib/searchFilters';

export type SearchPage = { items: Listing[]; hasMore: boolean; cursor: PageCursor | null };

export async function fetchSearchPage(input: SearchInput, cursor?: PageCursor | null, limit: number = SEARCH_PAGE_SIZE): Promise<SearchPage> {
  const { data, error } = await supabase.rpc('search_listings', toRpcParams(input, cursor, limit));
  if (error) throw error;
  const page = splitPage((data ?? []) as SearchRpcRow[], limit);
  const flags = new Map(page.items.map((r) => [r.listing.id, r]));
  // strict: a failed seller lookup fails the page instead of silently dropping every listing.
  const listings = await hydrateSellers(page.items.map((r) => r.listing as unknown as ListingRow), true);
  const items = listings.map((l) => ({ ...l, boosted: flags.get(l.id)?.is_boosted, priceReduced: flags.get(l.id)?.price_reduced }));
  return { items, hasMore: page.hasMore, cursor: page.cursor };
}
