// Server-side search (one page per call). All filtering, ordering and paging happens in Postgres via the
// search_listings() RPC (supabase/migrations/0038) — nothing here fetches "all listings" and filters in memory.
// Throws on any failure so callers can show an error state instead of a misleading "no results".
import { supabase } from '@/lib/supabase';
import { Listing, Profile } from '@/types';
import { getSellerStatsBatch, profileToSeller } from '@/lib/sellerStats';
import { rowToListing, ListingRow } from '@/store/myListings';
import { PageCursor, SearchInput, SearchRpcRow, SEARCH_PAGE_SIZE, splitPage, toRpcParams } from '@/lib/searchFilters';

export type SearchPage = { items: Listing[]; hasMore: boolean; cursor: PageCursor | null };

export async function fetchSearchPage(input: SearchInput, cursor?: PageCursor | null, limit: number = SEARCH_PAGE_SIZE): Promise<SearchPage> {
  const { data, error } = await supabase.rpc('search_listings', toRpcParams(input, cursor, limit));
  if (error) throw error;
  const page = splitPage((data ?? []) as SearchRpcRow[], limit);

  const userIds = Array.from(new Set(page.items.map((r) => (r.listing as unknown as ListingRow).user_id)));
  if (userIds.length === 0) return { items: [], hasMore: page.hasMore, cursor: page.cursor };

  const [{ data: profileRows, error: profileError }, statsMap] = await Promise.all([
    supabase.from('profiles').select('*').in('id', userIds),
    getSellerStatsBatch(userIds),
  ]);
  // A failed seller lookup must fail the page — never silently drop every listing.
  if (profileError) throw profileError;
  const profiles = new Map<string, Profile>((profileRows ?? []).map((p) => [(p as Profile).id, p as Profile]));

  const items: Listing[] = [];
  for (const r of page.items) {
    const row = r.listing as unknown as ListingRow;
    const profile = profiles.get(row.user_id);
    if (!profile) continue;
    const stats = statsMap.get(row.user_id) ?? { listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 };
    items.push({ ...rowToListing(row, profileToSeller(profile, stats, row.seller_presentation)), boosted: r.is_boosted, priceReduced: r.price_reduced });
  }
  return { items, hasMore: page.hasMore, cursor: page.cursor };
}
