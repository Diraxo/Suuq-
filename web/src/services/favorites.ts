// Real `favorites` table reads/writes, mirroring store/favorites.ts on
// mobile exactly (same table, same RLS: "users manage their own favorites").
import { supabase } from '@/lib/supabase';

export async function listFavoriteIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('favorites').select('listing_id').eq('user_id', userId);
  if (error) return [];
  return (data ?? []).map((r) => r.listing_id as string);
}

export async function addFavorite(userId: string, listingId: string): Promise<boolean> {
  const { error } = await supabase.from('favorites').insert({ user_id: userId, listing_id: listingId });
  return !error;
}

export async function removeFavorite(userId: string, listingId: string): Promise<boolean> {
  const { error } = await supabase.from('favorites').delete().eq('user_id', userId).eq('listing_id', listingId);
  return !error;
}
