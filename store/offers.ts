import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { isBlockedEitherWaySync } from '@/lib/blocking';
import i18n from '@/lib/i18n';

export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'countered' | 'cancelled' | 'expired' | 'sold';

export type Offer = {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  message: string | null;
  fromMe: boolean;
  status: OfferStatus;
  createdAt: string;
};

type OfferRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  from_user_id: string;
  amount: number | string;
  message: string | null;
  status: OfferStatus;
  created_at: string;
};

function rowToOffer(row: OfferRow, meId: string): Offer {
  return {
    id: row.id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    amount: Number(row.amount),
    message: row.message,
    fromMe: row.from_user_id === meId,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Buyers only ever have one thread (themselves); a seller viewing offers on
 *  their own listing may see several buyers' threads interleaved (RLS returns
 *  every row where they're seller_id) — pick whichever thread is most recently
 *  active, since the current offers screen has no buyer picker. */
function pickActiveThread(rows: OfferRow[]): OfferRow[] {
  if (rows.length === 0) return [];
  const byBuyer = new Map<string, OfferRow[]>();
  for (const row of rows) {
    const list = byBuyer.get(row.buyer_id) ?? [];
    list.push(row);
    byBuyer.set(row.buyer_id, list);
  }
  let best: OfferRow[] = [];
  let bestTime = -Infinity;
  for (const list of byBuyer.values()) {
    const latest = Math.max(...list.map((r) => new Date(r.created_at).getTime()));
    if (latest > bestTime) {
      bestTime = latest;
      best = list;
    }
  }
  return best.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

/** One row per (listing, buyer) thread — the inbox shows the latest offer in
 *  each thread the current user is a participant in, across every listing. */
export type OfferThread = {
  listingId: string;
  buyerId: string;
  sellerId: string;
  /** The current user's role in this thread. */
  role: 'buyer' | 'seller';
  status: OfferStatus;
  amount: number;
  currency: string;
  updatedAt: string;
  listingTitle: string;
  listingImage: string | null;
  counterpartyName: string;
  counterpartyAvatar: string | null;
};

type InboxRow = OfferRow & {
  listing: { id: string; title: string; images: string[] | null; currency: string } | null;
  buyer: { id: string; full_name: string | null; avatar_url: string | null } | null;
  seller: { id: string; full_name: string | null; avatar_url: string | null } | null;
};

type OfferState = {
  offers: Offer[];
  hasHydrated: boolean;
  listingId: string | null;
  inbox: OfferThread[];
  hasHydratedInbox: boolean;
  loadForListing: (listingId: string) => Promise<void>;
  subscribeListing: (listingId: string) => () => void;
  loadInbox: () => Promise<void>;
  createOffer: (listingId: string, amount: number, message?: string) => Promise<{ error?: string }>;
  accept: (offerId: string) => Promise<{ error?: string }>;
  decline: (offerId: string) => Promise<{ error?: string }>;
  counter: (offerId: string, amount: number, message?: string) => Promise<{ error?: string }>;
  cancel: (offerId: string) => Promise<{ error?: string }>;
  reset: () => void;
};

export const useOfferStore = create<OfferState>((set, get) => ({
  offers: [],
  hasHydrated: false,
  listingId: null,
  inbox: [],
  hasHydratedInbox: false,

  loadForListing: async (listingId) => {
    const session = useAuthStore.getState().session;
    if (!session) {
      set({ offers: [], hasHydrated: true, listingId });
      return;
    }
    await supabase.rpc('expire_stale_offers');
    const { data } = await supabase
      .from('offers')
      .select('id, listing_id, buyer_id, seller_id, from_user_id, amount, message, status, created_at')
      .eq('listing_id', listingId)
      .order('created_at', { ascending: true });
    const rows = (data ?? []) as OfferRow[];
    const thread = pickActiveThread(rows);
    set({ offers: thread.map((r) => rowToOffer(r, session.user.id)), hasHydrated: true, listingId });
  },

  subscribeListing: (listingId) => {
    const channel = supabase
      .channel(`offers-${listingId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'offers', filter: `listing_id=eq.${listingId}` }, () => {
        get().loadForListing(listingId);
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  },

  loadInbox: async () => {
    const session = useAuthStore.getState().session;
    if (!session) {
      set({ inbox: [], hasHydratedInbox: true });
      return;
    }
    const uid = session.user.id;
    await supabase.rpc('expire_stale_offers');
    const { data } = await supabase
      .from('offers')
      .select(
        'id, listing_id, buyer_id, seller_id, from_user_id, amount, message, status, created_at, ' +
          'listing:listings(id, title, images, currency), ' +
          'buyer:profiles!offers_buyer_id_fkey(id, full_name, avatar_url), ' +
          'seller:profiles!offers_seller_id_fkey(id, full_name, avatar_url)'
      )
      .or(`buyer_id.eq.${uid},seller_id.eq.${uid}`)
      .order('created_at', { ascending: false });

    const rows = (data ?? []) as unknown as InboxRow[];
    // Collapse to the latest row per (listing, buyer) thread — rows are
    // already newest-first, so the first row seen for a thread key wins.
    const seen = new Set<string>();
    const threads: OfferThread[] = [];
    for (const row of rows) {
      const key = `${row.listing_id}:${row.buyer_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const role: 'buyer' | 'seller' = row.buyer_id === uid ? 'buyer' : 'seller';
      const counterparty = role === 'buyer' ? row.seller : row.buyer;
      threads.push({
        listingId: row.listing_id,
        buyerId: row.buyer_id,
        sellerId: row.seller_id,
        role,
        status: row.status,
        amount: Number(row.amount),
        currency: row.listing?.currency ?? 'ETB',
        updatedAt: row.created_at,
        listingTitle: row.listing?.title ?? i18n.t('offers.unknownListingTitle'),
        listingImage: row.listing?.images?.[0] ?? null,
        counterpartyName: counterparty?.full_name ?? i18n.t('profile.defaultUserName'),
        counterpartyAvatar: counterparty?.avatar_url ?? null,
      });
    }
    set({ inbox: threads, hasHydratedInbox: true });
  },

  createOffer: async (listingId, amount, message) => {
    const { data: listingRow } = await supabase.from('listings').select('user_id').eq('id', listingId).maybeSingle();
    if (listingRow && listingRow.user_id === useAuthStore.getState().session?.user.id) {
      return { error: i18n.t('offers.cannotOfferOwnListing') };
    }
    if (listingRow && isBlockedEitherWaySync(listingRow.user_id)) {
      return { error: i18n.t('offers.cannotOfferBlockedSeller') };
    }
    const { error } = await supabase.rpc('create_offer', { p_listing_id: listingId, p_amount: amount, p_message: message ?? null });
    if (error) {
      if (__DEV__) console.error('[offers] createOffer failed:', error.message);
      return { error: i18n.t('offers.sendFailedMessage') };
    }
    await get().loadForListing(listingId);
    return {};
  },

  accept: async (offerId) => {
    const { error } = await supabase.rpc('respond_to_offer', { p_offer_id: offerId, p_action: 'accept' });
    if (error) {
      if (__DEV__) console.error('[offers] accept failed:', error.message);
      return { error: i18n.t('offers.acceptFailedMessage') };
    }
    if (get().listingId) await get().loadForListing(get().listingId!);
    return {};
  },

  decline: async (offerId) => {
    const { error } = await supabase.rpc('respond_to_offer', { p_offer_id: offerId, p_action: 'reject' });
    if (error) {
      if (__DEV__) console.error('[offers] decline failed:', error.message);
      return { error: i18n.t('offers.declineFailedMessage') };
    }
    if (get().listingId) await get().loadForListing(get().listingId!);
    return {};
  },

  counter: async (offerId, amount, message) => {
    const uid = useAuthStore.getState().session?.user.id;
    const thread = get().offers;
    const counterpartyId = thread.length ? (thread[0].buyerId === uid ? thread[0].sellerId : thread[0].buyerId) : null;
    if (counterpartyId && isBlockedEitherWaySync(counterpartyId)) {
      return { error: i18n.t('offers.cannotOfferBlockedUser') };
    }
    const { error } = await supabase.rpc('respond_to_offer', {
      p_offer_id: offerId,
      p_action: 'counter',
      p_counter_amount: amount,
      p_message: message ?? null,
    });
    if (error) {
      if (__DEV__) console.error('[offers] counter failed:', error.message);
      return { error: i18n.t('offers.counterFailedMessage') };
    }
    if (get().listingId) await get().loadForListing(get().listingId!);
    return {};
  },

  cancel: async (offerId) => {
    const { error } = await supabase.rpc('cancel_offer', { p_offer_id: offerId });
    if (error) {
      if (__DEV__) console.error('[offers] cancel failed:', error.message);
      return { error: i18n.t('offers.cancelFailedMessage') };
    }
    if (get().listingId) await get().loadForListing(get().listingId!);
    return {};
  },

  reset: () => set({ offers: [], hasHydrated: false, listingId: null, inbox: [], hasHydratedInbox: false }),
}));
