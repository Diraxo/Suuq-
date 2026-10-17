// Account-side reads/writes behind Followers & Following, Saved Searches and Recently Viewed. Same tables and
// columns as store/follow.ts, store/savedSearches.ts and store/recentlyViewed.ts on mobile.
import { supabase } from '@/lib/supabase';

export type Person = { id: string; name: string; avatar: string; city: string };

type ProfileLite = { id: string; full_name: string | null; avatar_url: string | null; city: string | null } | null;

function toPerson(p: ProfileLite): Person | null {
  if (!p) return null;
  return { id: p.id, name: p.full_name ?? 'SUUQIYE user', avatar: p.avatar_url ?? `https://picsum.photos/seed/${p.id}/200/200`, city: p.city ?? '' };
}

export async function listFollowers(userId: string): Promise<Person[]> {
  const { data } = await supabase
    .from('followers')
    .select('follower:profiles!followers_follower_id_fkey(id, full_name, avatar_url, city)')
    .eq('following_id', userId);
  return ((data ?? []) as unknown as { follower: ProfileLite }[]).map((r) => toPerson(r.follower)).filter((p): p is Person => !!p);
}

export async function listFollowing(userId: string): Promise<Person[]> {
  const { data } = await supabase
    .from('followers')
    .select('followee:profiles!followers_following_id_fkey(id, full_name, avatar_url, city)')
    .eq('follower_id', userId);
  return ((data ?? []) as unknown as { followee: ProfileLite }[]).map((r) => toPerson(r.followee)).filter((p): p is Person => !!p);
}

export async function followUser(me: string, target: string): Promise<boolean> {
  const { error } = await supabase.from('followers').insert({ follower_id: me, following_id: target });
  return !error;
}

export async function unfollowUser(me: string, target: string): Promise<boolean> {
  const { error } = await supabase.from('followers').delete().eq('follower_id', me).eq('following_id', target);
  return !error;
}

export type SavedSearch = { id: string; query: string; filter: string };

export async function listSavedSearches(userId: string): Promise<SavedSearch[]> {
  const { data } = await supabase.from('saved_searches').select('id, search_data').eq('user_id', userId).order('created_at', { ascending: false });
  return ((data ?? []) as { id: string; search_data: { query: string; filter: string } }[]).map((r) => ({
    id: r.id,
    query: r.search_data.query,
    filter: r.search_data.filter,
  }));
}

export async function addSavedSearch(userId: string, query: string, filter: string): Promise<boolean> {
  const { error } = await supabase.from('saved_searches').insert({ user_id: userId, search_data: { query, filter } });
  return !error;
}

export async function removeSavedSearch(id: string): Promise<boolean> {
  const { error } = await supabase.from('saved_searches').delete().eq('id', id);
  return !error;
}

const RECENT_KEY = 'suuq:recentlyViewed';
const RECENT_MAX = 30;

function readLocalRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Remembers a listing the user opened: signed-in users share one list with the app, guests keep a local list. */
export async function recordRecentlyViewed(userId: string | null, listingId: string): Promise<void> {
  if (!userId) {
    try {
      const next = [listingId, ...readLocalRecent().filter((x) => x !== listingId)].slice(0, RECENT_MAX);
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: nothing to remember */
    }
    return;
  }
  await supabase.from('recently_viewed').upsert({ user_id: userId, listing_id: listingId, viewed_at: new Date().toISOString() }, { onConflict: 'user_id,listing_id' });
}

export async function listRecentlyViewedIds(userId: string | null): Promise<string[]> {
  if (!userId) return readLocalRecent();
  const { data } = await supabase.from('recently_viewed').select('listing_id').eq('user_id', userId).order('viewed_at', { ascending: false }).limit(RECENT_MAX);
  return ((data ?? []) as { listing_id: string }[]).map((r) => r.listing_id);
}
