// Real `profiles` table reads + seller stats, mirroring lib/sellerStats.ts
// and store/auth.ts on mobile.
import { supabase } from '@/lib/supabase';
import { Profile, Seller } from '@/lib/types';

export type SellerStats = {
  listingsCount: number;
  soldCount: number;
  followers: number;
  rating: number;
  reviewCount: number;
};

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error || !data) return null;
  return data as Profile;
}

export async function getSellerStats(userId: string): Promise<SellerStats> {
  const [listingsRes, soldRes, followersRes, reviewsRes] = await Promise.all([
    supabase.from('listings').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('status', ['available', 'reserved']),
    supabase.from('listings').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'sold'),
    supabase.from('followers').select('id', { count: 'exact', head: true }).eq('following_id', userId),
    supabase.from('reviews').select('rating').eq('seller_id', userId),
  ]);
  const ratings = reviewsRes.data ?? [];
  const reviewCount = ratings.length;
  const rating = reviewCount > 0 ? ratings.reduce((sum, r) => sum + (r as { rating: number }).rating, 0) / reviewCount : 0;
  return {
    listingsCount: listingsRes.count ?? 0,
    soldCount: soldRes.count ?? 0,
    followers: followersRes.count ?? 0,
    rating,
    reviewCount,
  };
}

// Same batched pattern as getSellerStatsBatch in lib/sellerStats.ts on
// mobile — 3 queries total for however many distinct sellers are on screen,
// instead of one round trip per seller.
export async function getSellerStatsBatch(userIds: string[]): Promise<Map<string, SellerStats>> {
  const ids = Array.from(new Set(userIds));
  const map = new Map<string, SellerStats>();
  if (ids.length === 0) return map;
  for (const id of ids) map.set(id, { listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 });

  const [listingsRes, followersRes, reviewsRes] = await Promise.all([
    supabase.from('listings').select('user_id, status').in('user_id', ids),
    supabase.from('followers').select('following_id').in('following_id', ids),
    supabase.from('reviews').select('seller_id, rating').in('seller_id', ids),
  ]);

  for (const row of listingsRes.data ?? []) {
    const s = map.get(row.user_id as string);
    if (!s) continue;
    if (row.status === 'sold') s.soldCount++;
    else if (row.status === 'available' || row.status === 'reserved') s.listingsCount++;
  }
  for (const row of followersRes.data ?? []) {
    const s = map.get(row.following_id as string);
    if (s) s.followers++;
  }
  const ratingSums = new Map<string, number>();
  for (const row of reviewsRes.data ?? []) {
    const s = map.get(row.seller_id as string);
    if (!s) continue;
    s.reviewCount++;
    ratingSums.set(row.seller_id as string, (ratingSums.get(row.seller_id as string) ?? 0) + (row.rating as number));
  }
  for (const [id, sum] of ratingSums) {
    const s = map.get(id)!;
    s.rating = s.reviewCount > 0 ? sum / s.reviewCount : 0;
  }
  return map;
}

// Reconstructs the web app's Seller shape from a real profile row + stats —
// verification/level/responseTime have no backing table (same as mobile),
// so they default. Mirrors profileToSeller() in lib/sellerStats.ts exactly.
export function profileToSeller(profile: Profile, stats: SellerStats): Seller {
  return {
    id: profile.id,
    name: profile.full_name ?? 'Fursad user',
    avatar: profile.avatar_url ?? `https://picsum.photos/seed/${profile.id}/200/200`,
    city: profile.city ?? '',
    memberSince: new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    rating: stats.rating,
    reviewCount: stats.reviewCount,
    responseTime: '—',
    verified: false,
    level: 'new',
    listingsCount: stats.listingsCount,
    soldCount: stats.soldCount,
    followers: stats.followers,
    phone: profile.phone ?? undefined,
  };
}

// Part of the account-wins language sync policy — see LanguageSync.tsx.
export async function updateProfileLanguage(userId: string, locale: string): Promise<void> {
  await supabase.from('profiles').update({ language: locale }).eq('id', userId);
}
