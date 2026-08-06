import { create } from 'zustand';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Listing, ListingStatus, Seller } from '@/types';
import { PriceDrop } from '@/data/listingsRepository';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { getSellerStats, profileToSeller } from '@/lib/sellerStats';
import { storagePathFromPublicUrl } from '@/lib/storage';
import { deleteCloudinaryAssets } from '@/lib/cloudinary';
import { useListingsStore } from '@/store/listings';

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
  status: ListingStatus;
  created_at: string;
  updated_at: string;
  sold_at: string | null;
};

export function rowToListing(row: ListingRow, seller: Seller): Listing {
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
    postedAt: '',
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    soldAt: row.sold_at ? new Date(row.sold_at).getTime() : undefined,
    status: row.status,
    // Phone is a profile-level concept, not per-listing — `seller` already
    // carries it from profileToSeller(profile), so it's used as-is here.
    seller,
    views: row.views,
    favoritesCount: row.favorites_count,
    attributes: row.attributes ?? undefined,
    features: row.features?.length ? row.features : undefined,
    sellerNotes: row.seller_notes?.length ? row.seller_notes : undefined,
  };
}

export function listingToRow(listing: Listing, userId: string) {
  return {
    user_id: userId,
    title: listing.title,
    description: listing.description,
    category: listing.category,
    subcategory: listing.subcategory ?? null,
    condition: listing.condition,
    price: listing.price,
    currency: listing.currency,
    city: listing.city,
    region: listing.region,
    images: listing.images,
    image_public_ids: listing.imagePublicIds ?? [],
    negotiable: listing.negotiable,
    attributes: listing.attributes ?? {},
    features: listing.features ?? [],
    seller_notes: listing.sellerNotes ?? [],
    status: listing.status,
  };
}

type MyListingsState = {
  listings: Listing[];
  priceDrops: PriceDrop[];
  hasHydrated: boolean;
  lastError: string | null;
  load: () => Promise<void>;
  addListing: (listing: Listing) => Promise<Listing | null>;
  updateListing: (id: string, patch: Partial<Listing>) => Promise<void>;
  removeListing: (id: string) => Promise<void>;
  dropPrice: (id: string, newPrice: number) => Promise<void>;
  reset: () => void;
};

export const useMyListingsStore = create<MyListingsState>((set, get) => ({
  listings: [],
  priceDrops: [],
  hasHydrated: false,
  lastError: null,

  load: async () => {
    const { session, profile } = useAuthStore.getState();
    if (!session || !profile) {
      set({ listings: [], priceDrops: [], hasHydrated: true });
      return;
    }

    const [{ data: rows }, stats] = await Promise.all([
      supabase.from('listings').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }),
      getSellerStats(session.user.id),
    ]);
    const seller = profileToSeller(profile, stats);
    const listings = (rows ?? []).map((row) => rowToListing(row as ListingRow, seller));

    const listingIds = listings.map((l) => l.id);
    const { data: dropRows } =
      listingIds.length > 0
        ? await supabase.from('price_drops').select('*').in('listing_id', listingIds).order('created_at', { ascending: false })
        : { data: [] as any[] };
    const priceDrops: PriceDrop[] = (dropRows ?? []).map((d: any) => ({
      listingId: d.listing_id,
      oldPrice: Number(d.old_price),
      newPrice: Number(d.new_price),
      droppedAt: new Date(d.created_at).toLocaleDateString(),
    }));

    set({ listings, priceDrops, hasHydrated: true });
  },

  addListing: async (listing) => {
    const { session, profile } = useAuthStore.getState();
    if (!session || !profile) {
      console.error('[publish] insert listing row: FAILED — no active session/profile');
      set({ lastError: 'You are not signed in.' });
      return null;
    }
    console.log('[publish] insert listing row: inserting');
    const { data, error } = await supabase.from('listings').insert(listingToRow(listing, session.user.id)).select('*').single();
    if (error || !data) {
      console.error('[publish] insert listing row: FAILED —', error?.message, error);
      set({ lastError: error?.message ?? 'Unknown error inserting listing' });
      return null;
    }
    console.log('[publish] insert listing row: done, id', data.id);
    set({ lastError: null });

    const stats = await getSellerStats(session.user.id);
    const seller = profileToSeller(profile, stats);
    const created = rowToListing(data as ListingRow, seller);
    set((state) => ({ listings: [created, ...state.listings] }));
    useListingsStore.getState().upsertLocal(created);
    useListingsStore.getState().load();
    console.log('[publish] finish: publish flow complete');
    return created;
  },

  updateListing: async (id, patch) => {
    const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.category !== undefined) dbPatch.category = patch.category;
    // 'subcategory' in patch (not !== undefined) so clearing it — e.g. Edit
    // Listing switching to a category with no subcategories — actually writes
    // null instead of silently skipping the column because the new value is undefined.
    if ('subcategory' in patch) dbPatch.subcategory = patch.subcategory ?? null;
    if (patch.condition !== undefined) dbPatch.condition = patch.condition;
    if (patch.price !== undefined) dbPatch.price = patch.price;
    if (patch.currency !== undefined) dbPatch.currency = patch.currency;
    if (patch.city !== undefined) dbPatch.city = patch.city;
    if (patch.region !== undefined) dbPatch.region = patch.region;
    if (patch.images !== undefined) dbPatch.images = patch.images;
    if (patch.imagePublicIds !== undefined) dbPatch.image_public_ids = patch.imagePublicIds;
    if (patch.negotiable !== undefined) dbPatch.negotiable = patch.negotiable;
    if (patch.attributes !== undefined) dbPatch.attributes = patch.attributes;
    if (patch.features !== undefined) dbPatch.features = patch.features;
    if (patch.sellerNotes !== undefined) dbPatch.seller_notes = patch.sellerNotes;
    if (patch.status !== undefined) dbPatch.status = patch.status;

    const { error } = await supabase.from('listings').update(dbPatch).eq('id', id);
    if (error) return;
    // Mirrors the `listings_set_sold_at` DB trigger (0010_listing_sold_at.sql)
    // client-side so soldAt is correct immediately, without waiting on a reload.
    const current = get().listings.find((l) => l.id === id);
    const soldAtPatch: Partial<Listing> =
      patch.status === undefined || !current || patch.status === current.status
        ? {}
        : patch.status === 'sold'
          ? { soldAt: Date.now() }
          : { soldAt: undefined };
    set((state) => ({
      listings: state.listings.map((l) => (l.id === id ? { ...l, ...patch, ...soldAtPatch } : l)),
    }));
    useListingsStore.getState().patchLocal(id, { ...patch, ...soldAtPatch });
  },

  removeListing: async (id) => {
    const listing = get().listings.find((l) => l.id === id);
    if (listing?.images.length) {
      // Persisted public_id first (accurate for any URL shape), falling back
      // to regex-derivation from the URL for pre-migration rows.
      const publicIds = listing.images
        .map((url, i) => listing.imagePublicIds?.[i] || storagePathFromPublicUrl(url))
        .filter((p): p is string => !!p);
      if (publicIds.length) {
        const { failed } = await deleteCloudinaryAssets(publicIds);
        if (failed.length) {
          console.warn(`[Cloudinary] Listing delete: failed to clean up ${failed.length}/${publicIds.length} image(s):`, failed);
        }
      }
    }
    // The listing row is deleted regardless of Cloudinary cleanup outcome —
    // a failed best-effort image cleanup should never block the user's delete.
    const { error } = await supabase.from('listings').delete().eq('id', id);
    if (error) return;
    set((state) => ({
      listings: state.listings.filter((l) => l.id !== id),
    }));
    useListingsStore.getState().removeLocal(id);
  },

  dropPrice: async (id, newPrice) => {
    const current = get().listings.find((l) => l.id === id);
    if (!current) return;
    const { error } = await supabase.from('listings').update({ price: newPrice, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) return;
    await supabase.from('price_drops').insert({ listing_id: id, old_price: current.price, new_price: newPrice });
    set((state) => ({
      listings: state.listings.map((l) => (l.id === id ? { ...l, price: newPrice } : l)),
      priceDrops: [
        { listingId: id, oldPrice: current.price, newPrice, droppedAt: 'just now' },
        ...state.priceDrops.filter((d) => d.listingId !== id),
      ],
    }));
    useListingsStore.getState().patchLocal(id, { price: newPrice });
  },

  reset: () => {
    get().load();
  },
}));

let listingsChannel: RealtimeChannel | null = null;

function subscribeRealtime(userId: string) {
  if (listingsChannel) supabase.removeChannel(listingsChannel);
  // Picks up server-side status/view changes this store didn't itself write —
  // e.g. respond_to_offer() flipping a listing to 'sold' when an offer is
  // accepted, or increment_listing_views() bumping views on someone else's
  // view — so My Listings / Profile stats update live instead of only after
  // this store's own updateListing()/dropPrice() optimistic patches.
  listingsChannel = supabase
    .channel(`my-listings-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'listings', filter: `user_id=eq.${userId}` }, () => {
      useMyListingsStore.getState().load();
    })
    .subscribe();
}

let lastUserId: string | null = null;
useAuthStore.subscribe((state) => {
  const uid = state.session?.user.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;
  if (uid) {
    useMyListingsStore.getState().load();
    subscribeRealtime(uid);
  } else {
    useMyListingsStore.getState().reset();
    if (listingsChannel) supabase.removeChannel(listingsChannel);
    listingsChannel = null;
  }
});
