// Real `listings` table reads, mirroring store/listings.ts on mobile: public
// cross-seller feed (RLS: publicly readable), joined with profiles + batched
// seller stats. No mock catalogue fallback — an empty result is a real empty
// state (see §9 of the Phase 2 brief: never reintroduce the old demo listings).
import { supabase } from '@/lib/supabase';
import { Listing, Seller, Profile } from '@/lib/types';
import { getSellerStatsBatch, profileToSeller } from '@/services/profile';
import { formatRelativeTime } from '@/lib/time';

type ListingRow = {
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

async function hydrateSellers(rows: ListingRow[]): Promise<Listing[]> {
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  if (userIds.length === 0) return [];

  const [{ data: profileRows }, statsMap] = await Promise.all([
    supabase.from('profiles').select('*').in('id', userIds),
    getSellerStatsBatch(userIds),
  ]);
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

export async function listListings(): Promise<Listing[]> {
  const { data, error } = await supabase.from('listings').select('*').order('created_at', { ascending: false });
  if (error || !data) return [];
  return hydrateSellers(data as ListingRow[]);
}

export async function getListing(id: string): Promise<Listing | undefined> {
  const { data, error } = await supabase.from('listings').select('*').eq('id', id).maybeSingle();
  if (error || !data) return undefined;
  const [listing] = await hydrateSellers([data as ListingRow]);
  return listing;
}

export async function listListingsByCategory(categoryId: string): Promise<Listing[]> {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('category', categoryId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return hydrateSellers(data as ListingRow[]);
}

export async function listListingsByIds(ids: string[]): Promise<Listing[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('listings').select('*').in('id', ids);
  if (error || !data) return [];
  return hydrateSellers(data as ListingRow[]);
}

export async function listSimilarListings(listing: Listing): Promise<Listing[]> {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('category', listing.category)
    .neq('id', listing.id)
    .order('created_at', { ascending: false })
    .limit(6);
  if (error || !data) return [];
  return hydrateSellers(data as ListingRow[]);
}

// Powers Home's "Price Drops" tab — listing ids with a recorded price drop,
// most recent first (mirrors store/listings.ts's priceDropAt map on mobile).
export async function listRecentPriceDropIds(): Promise<string[]> {
  const { data, error } = await supabase.from('price_drops').select('listing_id, created_at').order('created_at', { ascending: false });
  if (error || !data) return [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const row of data as { listing_id: string }[]) {
    if (seen.has(row.listing_id)) continue;
    seen.add(row.listing_id);
    ordered.push(row.listing_id);
  }
  return ordered;
}

// RPC — `listings.views` is not directly client-writable (see 0019_security_hardening.sql).
export async function incrementListingViews(listingId: string): Promise<void> {
  await supabase.rpc('increment_listing_views', { p_listing_id: listingId });
}

export type NewListingInput = {
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
  negotiable: boolean;
};

// Mirrors listingToRow()/addListing() in store/myListings.ts on mobile —
// same table, same columns, same RLS (`with check (auth.uid() = user_id)`).
export async function createListing(userId: string, input: NewListingInput): Promise<{ listing?: Listing; error?: string }> {
  const { data, error } = await supabase
    .from('listings')
    .insert({
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
      negotiable: input.negotiable,
      attributes: {},
      features: [],
      seller_notes: [],
      status: 'available',
    })
    .select('*')
    .single();
  if (error || !data) return { error: error?.message ?? 'Could not publish listing.' };
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
  await supabase.from('price_drops').insert({ listing_id: id, old_price: oldPrice, new_price: newPrice });
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
