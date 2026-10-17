// Targeted listing reads (supabase/migrations/0043). Each function asks Postgres for exactly what one screen shows —
// nothing here downloads "all listings". All of them throw on failure so callers can show an error state instead of a
// misleading "not found" / "no results". Blocked sellers (either direction), removed and deactivated listings are
// filtered by the database, never by the client.
import { supabase } from '@/lib/supabase';
import { Listing, Profile } from '@/types';
import { getSellerStatsBatch, profileToSeller } from '@/lib/sellerStats';
import { rowToListing, ListingRow } from '@/store/myListings';
import { LOOKUP_CHUNK_SIZE } from '@/lib/listingsCore';

type RpcListingRow = { listing: ListingRow };

/** Raw `listings` rows -> Listing, with each seller's profile + stats looked up in two batched requests. Rows whose seller profile is gone are dropped, exactly as the old startup query did. */
export async function hydrateListingRows(rows: ListingRow[]): Promise<Listing[]> {
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  if (userIds.length === 0) return [];
  const [{ data: profileRows, error: profileError }, statsMap] = await Promise.all([supabase.from('profiles').select('*').in('id', userIds), getSellerStatsBatch(userIds)]);
  // A failed seller lookup must fail the read — never look like "no sellers" (every listing would be dropped below).
  if (profileError) throw profileError;
  const profiles = new Map<string, Profile>((profileRows ?? []).map((p) => [(p as Profile).id, p as Profile]));
  const items: Listing[] = [];
  for (const row of rows) {
    const profile = profiles.get(row.user_id);
    if (!profile) continue;
    const stats = statsMap.get(row.user_id) ?? { listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 };
    items.push(rowToListing(row, profileToSeller(profile, stats)));
  }
  return items;
}

const toRows = (data: unknown): ListingRow[] => ((data ?? []) as RpcListingRow[]).map((r) => r.listing);

/** The visible listings among `ids` (one request per LOOKUP_CHUNK_SIZE; the caller (listingsCore) already chunks). Hidden/blocked/unknown ids are simply absent. */
export async function fetchListingsByIds(ids: string[]): Promise<Listing[]> {
  if (ids.length === 0) return [];
  if (ids.length > LOOKUP_CHUNK_SIZE) throw new Error(`fetchListingsByIds: at most ${LOOKUP_CHUNK_SIZE} ids per call`);
  const { data, error } = await supabase.rpc('listings_by_ids', { p_ids: ids });
  if (error) throw error;
  return hydrateListingRows(toRows(data));
}

export const SELLER_LISTINGS_LIMIT = 100;
export type SellerListingsPage = { items: Listing[]; hasMore: boolean };

/** One seller's listings, newest first (up to SELLER_LISTINGS_LIMIT; `hasMore` says the seller has more). */
export async function fetchSellerListings(sellerId: string, limit: number = SELLER_LISTINGS_LIMIT): Promise<SellerListingsPage> {
  const { data, error } = await supabase.rpc('seller_listings', { p_seller_id: sellerId, p_limit: limit });
  if (error) throw error;
  const rows = toRows(data);
  return { items: await hydrateListingRows(rows.slice(0, limit)), hasMore: rows.length > limit };
}

export const COMPARABLE_SAMPLE = 100;

/** Same-category, available candidates (same-subcategory first, then newest), capped. The caller ranks them. */
export async function fetchComparableListings(args: { category: string; subcategory?: string | null; excludeId?: string | null; limit?: number }): Promise<Listing[]> {
  if (!args.category) return [];
  const { data, error } = await supabase.rpc('comparable_listings', {
    p_category: args.category,
    p_subcategory: args.subcategory ?? null,
    p_exclude_id: args.excludeId ?? null,
    p_limit: args.limit ?? COMPARABLE_SAMPLE,
  });
  if (error) throw error;
  return hydrateListingRows(toRows(data));
}

export const SAVED_SEARCH_COUNT_CAP = 100;

/** "N matches" per saved-search text (each count stops at SAVED_SEARCH_COUNT_CAP; at most 20 texts are answered). */
export async function fetchSavedSearchCounts(queries: string[]): Promise<Record<string, number>> {
  const texts = Array.from(new Set(queries.map((q) => q.trim()).filter(Boolean))).slice(0, 20);
  if (texts.length === 0) return {};
  const { data, error } = await supabase.rpc('saved_search_counts', { p_queries: texts });
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { query: string; n: number }[]) out[r.query] = Number(r.n);
  return out;
}
