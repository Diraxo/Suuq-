// Real `offers` RPC wiring, mirroring store/offers.ts on mobile exactly.
// All writes go through SECURITY DEFINER RPCs — direct insert/update against
// `offers` is rejected by RLS by design (see 0006_offers.sql / 0019_security_hardening.sql).
import { supabase } from '@/lib/supabase';
import { Offer, OfferStatus } from '@/lib/types';

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

function rowToOffer(row: OfferRow): Offer {
  return {
    id: row.id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    fromUserId: row.from_user_id,
    amount: Number(row.amount),
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function listOffersForListing(listingId: string): Promise<Offer[]> {
  await supabase.rpc('expire_stale_offers');
  const { data, error } = await supabase
    .from('offers')
    .select('id, listing_id, buyer_id, seller_id, from_user_id, amount, message, status, created_at')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as OfferRow[]).map(rowToOffer);
}

export async function createOffer(listingId: string, amount: number, message?: string): Promise<{ offer?: Offer; error?: string }> {
  const { data, error } = await supabase.rpc('create_offer', { p_listing_id: listingId, p_amount: amount, p_message: message ?? null });
  if (error || !data) return { error: error?.message ?? 'Could not send offer.' };
  return { offer: rowToOffer(data as OfferRow) };
}

export async function respondToOffer(
  offerId: string,
  action: 'accept' | 'reject' | 'counter',
  counterAmount?: number,
  message?: string
): Promise<{ offer?: Offer; error?: string }> {
  const { data, error } = await supabase.rpc('respond_to_offer', {
    p_offer_id: offerId,
    p_action: action,
    p_counter_amount: counterAmount ?? null,
    p_message: message ?? null,
  });
  if (error || !data) return { error: error?.message ?? 'Could not respond to offer.' };
  return { offer: rowToOffer(data as OfferRow) };
}

export async function cancelOffer(offerId: string): Promise<{ offer?: Offer; error?: string }> {
  const { data, error } = await supabase.rpc('cancel_offer', { p_offer_id: offerId });
  if (error || !data) return { error: error?.message ?? 'Could not cancel offer.' };
  return { offer: rowToOffer(data as OfferRow) };
}
