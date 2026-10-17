// Real `listings` table reads, mirroring store/listings.ts on mobile: public
// cross-seller feed (RLS: publicly readable), joined with profiles + batched
// seller stats. No mock catalogue fallback — an empty result is a real empty
// state (see §9 of the Phase 2 brief: never reintroduce the old demo listings).
import { supabase } from '@/lib/supabase';
import { Listing, Seller, Profile } from '@/lib/types';
import { getSellerStatsBatch, profileToSeller } from '@/services/profile';
import { formatRelativeTime } from '@/lib/time';

export type ListingRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  condition: string | null;
  price: number | string;
  currency: string;
  city: string | null;
  region: string | null;
  images: string[] | null;
  image_public_ids: string[] | null;
  negotiable: boolean;
  views: number;
  favorites_count: number;
  attributes: Record<string, string> | null;
  features: string[] | null;
  seller_notes: string[] | null;
  status: Listing['status'];
  created_at: string;
  updated_at: string;
};

function rowToListing(row: ListingRow, seller: Seller): Listing {
  return {
    id: row.id,
    title: row.title,
    price: Number(row.price),
    currency: row.currency,
    negotiable: row.negotiable,
    condition: (row.condition as Listing['condition']) ?? 'used',
    category: row.category ?? '',
    subcategory: row.subcategory ?? undefined,
    city: row.city ?? '',
    region: row.region ?? '',
    images: row.images ?? [],
    imagePublicIds: row.image_public_ids?.length ? row.image_public_ids : undefined,
    description: row.description ?? '',
    postedLabel: formatRelativeTime(new Date(row.created_at).getTime()),
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    status: row.status,
    seller,
    views: row.views,
    favoritesCount: row.favorites_count,
    attributes: row.attributes ?? undefined,
    features: row.features?.length ? row.features : undefined,
    sellerNotes: row.seller_notes?.length ? row.seller_notes : undefined,
  };
}

export async function hydrateSellers(rows: ListingRow[], strict = false): Promise<Listing[]> {
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  if (userIds.length === 0) return [];

  const [{ data: profileRows, error: profileError }, statsMap] = await Promise.all([
    supabase.from('profiles').select('*').in('id', userIds),
    getSellerStatsBatch(userIds),
  ]);
  // strict (Home refresh): a failed profiles query must not silently drop every listing.
  if (strict && profileError) throw profileError;
  const profileMap = new Map<string, Profile>((profileRows ?? []).map((p) => [(p as Profile).id, p as Profile]));

  return rows
    .map((row) => {
      const profile = profileMap.get(row.user_id);
      if (!profile) return null;
      const stats = statsMap.get(row.user_id) ?? { listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 };
      return rowToListing(row, profileToSeller(profile, stats));
    })
    .filter((l): l is Listing => !!l);
}

// Public reads go through the 0043 RPCs, which hide removed/deactivated listings and any seller blocked in EITHER direction
// (the database decides; a blocked listing is indistinguishable from a missing one). Nothing here downloads "all listings".
async function listingRowsByIds(ids: string[]): Promise<ListingRow[]> {
  const { data, error } = await supabase.rpc('listings_by_ids', { p_ids: ids });
  if (error || !data) return [];
  return (data as { listing: ListingRow }[]).map((r) => r.listing);
}

/** One listing by id. Public visibility rules first; a signed-in owner may still open their own removed/deactivated listing (appeals, edit). */
export async function getListing(id: string): Promise<Listing | undefined> {
  let [row] = await listingRowsByIds([id]);
  if (!row) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return undefined;
    const { data } = await supabase.from('listings').select('*').eq('id', id).eq('user_id', session.user.id).maybeSingle();
    row = data as ListingRow;
  }
  if (!row) return undefined;
  const [listing] = await hydrateSellers([row]);
  return listing;
}

export async function listListingsByIds(ids: string[]): Promise<Listing[]> {
  if (ids.length === 0) return [];
  const rows: ListingRow[] = [];
  for (let i = 0; i < ids.length; i += 200) rows.push(...(await listingRowsByIds(ids.slice(i, i + 200))));
  return hydrateSellers(rows);
}

export type SellerListingsPage = { items: Listing[]; hasMore: boolean };

/** One seller's visible listings, newest first (block-aware seller_listings() RPC, capped at 100). */
export async function listSellerListings(sellerId: string, limit = 100): Promise<SellerListingsPage> {
  const { data, error } = await supabase.rpc('seller_listings', { p_seller_id: sellerId, p_limit: limit });
  if (error || !data) return { items: [], hasMore: false };
  const rows = (data as { listing: ListingRow }[]).map((r) => r.listing);
  return { items: await hydrateSellers(rows.slice(0, limit)), hasMore: rows.length > limit };
}

export async function listSimilarListings(listing: Listing): Promise<Listing[]> {
  const { data, error } = await supabase.rpc('comparable_listings', {
    p_category: listing.category,
    p_subcategory: listing.subcategory ?? null,
    p_exclude_id: listing.id,
    p_limit: 6,
  });
  if (error || !data) return [];
  return hydrateSellers((data as { listing: ListingRow }[]).map((r) => r.listing));
}

// RPC — `listings.views` is not directly client-writable (see 0019_security_hardening.sql).
export async function incrementListingViews(listingId: string): Promise<void> {
  await supabase.rpc('increment_listing_views', { p_listing_id: listingId });
}

export type NewListingInput = {
  /**
   * Client-generated row id, stable across publish retries. Passing the same
   * id again resolves to an idempotent UPSERT — a lost network response on a
   * first attempt that actually committed can't create a duplicate listing on
   * retry. Omit to let Postgres assign one (single-shot inserts).
   */
  id?: string;
  title: string;
  description: string;
  category: string;
  subcategory?: string | null;
  condition: Listing['condition'];
  price: number;
  currency: string;
  city: string;
  region: string;
  images: string[];
  /** R2 object keys for images, persisted as image_public_ids so listing/account deletion can clean up. */
  imageKeys?: string[];
  negotiable: boolean;
  /** Category-specific specs, already sanitized against the active schema by the caller (lib/sellRules sanitizeAttributes). */
  attributes?: Record<string, string>;
  features?: string[];
  sellerNotes?: string[];
};

// Mirrors listingToRow()/addListing() in store/myListings.ts on mobile —
// same table, same columns, same RLS (`with check (auth.uid() = user_id)`).
//
// Returns the raw Supabase error (not a flattened string) so callers can run
// it through toAppError() and classify it (RLS vs. rate-limit vs. validation
// vs. network) instead of pattern-matching on message text.
export async function createListing(
  userId: string,
  input: NewListingInput
): Promise<{ listing?: Listing; error?: unknown }> {
  const row = {
    ...(input.id ? { id: input.id } : {}),
    user_id: userId,
    title: input.title,
    description: input.description,
    category: input.category,
    subcategory: input.subcategory ?? null,
    condition: input.condition,
    price: input.price,
    currency: input.currency,
    city: input.city,
    region: input.region,
    images: input.images,
    image_public_ids: input.imageKeys ?? [],
    negotiable: input.negotiable,
    attributes: input.attributes ?? {},
    features: input.features ?? [],
    seller_notes: input.sellerNotes ?? [],
    status: 'available' as const,
  };

  // UPSERT when the caller supplied a stable id (retry-safe); plain INSERT
  // otherwise. Both paths satisfy the same RLS: insert needs
  // `with check (auth.uid() = user_id)`, the update half of an upsert needs
  // the "users can update their own listings" policy — a caller can only ever
  // re-write a row keyed to their own id.
  const query = input.id
    ? supabase.from('listings').upsert(row, { onConflict: 'id' })
    : supabase.from('listings').insert(row);

  const { data, error } = await query.select('*').single();
  if (error || !data) return { error: error ?? new Error('Could not publish listing.') };
  const [listing] = await hydrateSellers([data as ListingRow]);
  return { listing };
}

// Powers My Listings (app/my-listings.tsx on mobile) — every status, not just
// 'available', so the Active/Reserved/Sold/Expired tabs all have data.
export async function listMyListings(userId: string): Promise<Listing[]> {
  const { data, error } = await supabase.from('listings').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error || !data) return [];
  return hydrateSellers(data as ListingRow[]);
}

export type ListingUpdateInput = {
  title?: string;
  description?: string;
  category?: string;
  subcategory?: string | null;
  condition?: Listing['condition'];
  price?: number;
  currency?: string;
  city?: string;
  region?: string;
  negotiable?: boolean;
  status?: Listing['status'];
  images?: string[];
  imagePublicIds?: string[];
  attributes?: Record<string, string>;
  features?: string[];
};

// Mirrors updateListing() in store/myListings.ts on mobile — same table,
// same partial-column-write pattern (`'subcategory' in patch` so clearing it
// to null is distinguishable from not touching the column at all).
export async function updateListing(id: string, patch: ListingUpdateInput): Promise<{ error?: string }> {
  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.category !== undefined) dbPatch.category = patch.category;
  if ('subcategory' in patch) dbPatch.subcategory = patch.subcategory ?? null;
  if (patch.condition !== undefined) dbPatch.condition = patch.condition;
  if (patch.price !== undefined) dbPatch.price = patch.price;
  if (patch.currency !== undefined) dbPatch.currency = patch.currency;
  if (patch.city !== undefined) dbPatch.city = patch.city;
  if (patch.region !== undefined) dbPatch.region = patch.region;
  if (patch.negotiable !== undefined) dbPatch.negotiable = patch.negotiable;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.images !== undefined) dbPatch.images = patch.images;
  if (patch.imagePublicIds !== undefined) dbPatch.image_public_ids = patch.imagePublicIds;
  if (patch.attributes !== undefined) dbPatch.attributes = patch.attributes;
  if (patch.features !== undefined) dbPatch.features = patch.features;
  const { error } = await supabase.from('listings').update(dbPatch).eq('id', id);
  return error ? { error: error.message } : {};
}

// Only path that flips a listing to 'sold' — a seller's explicit "I received
// payment" confirmation. Mirrors markSold() in store/myListings.ts on mobile:
// goes through the mark_listing_sold RPC (not a plain table update) so it
// also flips any other still-pending offer on this listing to 'sold', which
// requires SECURITY DEFINER since offers has no direct update policy (see
// 0006_offers.sql).
export async function markListingSold(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('mark_listing_sold', { p_listing_id: id });
  return error ? { error: error.message } : {};
}

export async function deleteListingRow(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('listings').delete().eq('id', id);
  return error ? { error: error.message } : {};
}

export type PriceDrop = { listingId: string; oldPrice: number; newPrice: number; droppedAt: string };

// Mirrors dropPrice() in store/myListings.ts on mobile: writes the new price,
// then records the drop in `price_drops` so Listing Insights can show a count.
export async function dropListingPrice(id: string, oldPrice: number, newPrice: number): Promise<{ error?: string }> {
  const { error } = await supabase.from('listings').update({ price: newPrice, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return { error: error.message };
  // The price_drops row is recorded by the database (trigger on listings.price, migration 0038), for this and
  // every other edit path — a client insert is neither needed nor permitted.
  void oldPrice;
  return {};
}

export async function listPriceDrops(listingIds: string[]): Promise<PriceDrop[]> {
  if (listingIds.length === 0) return [];
  const { data, error } = await supabase.from('price_drops').select('*').in('listing_id', listingIds).order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as { listing_id: string; old_price: number | string; new_price: number | string; created_at: string }[]).map((d) => ({
    listingId: d.listing_id,
    oldPrice: Number(d.old_price),
    newPrice: Number(d.new_price),
    droppedAt: d.created_at,
  }));
}
