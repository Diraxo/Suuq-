// Real Supabase search, mirroring the same `listings` table/RLS every other
// listings query uses — no separate search index, so results always match
// what Home/Category show (see §11 of the Phase 2 brief).
import { supabase } from '@/lib/supabase';
import { Listing } from '@/lib/types';
import { listListings } from './listings';

export type SearchParams = {
  query?: string;
  category?: string;
  city?: string | null;
};

export async function searchListings({ query, category, city }: SearchParams): Promise<Listing[]> {
  // Reuses listListings()'s row->Listing hydration (profile + seller stats
  // join) rather than duplicating it — filters are applied at the DB level
  // via a second lightweight query for just matching ids/order, then the
  // full hydrated set is filtered client-side against that.
  let q = supabase.from('listings').select('id').order('created_at', { ascending: false });
  if (query) q = q.ilike('title', `%${query}%`);
  if (category) q = q.eq('category', category);
  if (city) q = q.eq('city', city);
  const { data, error } = await q;
  if (error || !data) return [];
  const matchedIds = new Set((data as { id: string }[]).map((r) => r.id));
  if (matchedIds.size === 0) return [];

  const all = await listListings();
  const order = [...matchedIds];
  const byId = new Map(all.filter((l) => matchedIds.has(l.id)).map((l) => [l.id, l]));
  return order.map((id) => byId.get(id)).filter((l): l is Listing => !!l);
}
