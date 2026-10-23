import { create } from 'zustand';
import { accountPerson } from '@/lib/profileIdentity';
import { AppState } from 'react-native';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { isBlockedEitherWaySync } from '@/lib/blocking';
import { showSnackbar } from '@/lib/snackbar';
import i18n from '@/lib/i18n';

export type FollowPerson = { id: string; name: string; avatar: string; city: string };

type FollowStore = {
  followingIds: Set<string>;
  /** Ids with an insert/delete currently in flight — guards against a rapid double-tap firing two opposing writes that race and leave the UI on the wrong state. */
  pendingIds: Set<string>;
  followers: FollowPerson[];
  following: FollowPerson[];
  hasHydrated: boolean;
  isFollowing: (id: string) => boolean;
  toggle: (id: string) => void;
  load: () => Promise<void>;
  reset: () => void;
};

function toPerson(row: { id: string; full_name: string | null; avatar_url: string | null; active_mode?: string | null; business_name?: string | null; business_logo_url?: string | null; city: string | null }): FollowPerson {
  return {
    id: row.id,
    name: accountPerson(row).name ?? i18n.t('profile.defaultUserName'),
    avatar: accountPerson(row).avatarUrl ?? `https://picsum.photos/seed/${row.id}/200/200`,
    city: row.city ?? '',
  };
}

export const useFollowStore = create<FollowStore>((set, get) => ({
  followingIds: new Set(),
  pendingIds: new Set(),
  followers: [],
  following: [],
  hasHydrated: false,
  isFollowing: (id) => get().followingIds.has(id),
  toggle: (id) => {
    const session = useAuthStore.getState().session;
    if (!session) return;
    // A second tap while the first insert/delete is still in flight would read the
    // just-set optimistic value and fire the opposite write — the two requests then
    // race and can land in either order, which is what made Follow flicker back off.
    if (get().pendingIds.has(id)) return;
    const wasFollowing = get().followingIds.has(id);
    // Unfollowing is always allowed (e.g. cleaning up before/after a block);
    // only a brand-new follow is refused between blocked users.
    if (!wasFollowing && isBlockedEitherWaySync(id)) {
      showSnackbar(i18n.t('follow.cannotFollowBlocked'));
      return;
    }

    set((s) => {
      const next = new Set(s.followingIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const pending = new Set(s.pendingIds);
      pending.add(id);
      return { followingIds: next, pendingIds: pending };
    });

    const write = wasFollowing
      ? supabase.from('followers').delete().eq('follower_id', session.user.id).eq('following_id', id)
      : supabase.from('followers').insert({ follower_id: session.user.id, following_id: id });

    write.then(({ error }) => {
      set((s) => {
        const pending = new Set(s.pendingIds);
        pending.delete(id);
        return { pendingIds: pending };
      });
      if (!error) {
        get().load();
        return;
      }
      set((s) => {
        const next = new Set(s.followingIds);
        if (wasFollowing) next.add(id);
        else next.delete(id);
        return { followingIds: next };
      });
      showSnackbar(i18n.t('follow.updateFailedSnackbar'));
    });
  },
  load: async () => {
    const session = useAuthStore.getState().session;
    if (!session) {
      set({ followingIds: new Set(), followers: [], following: [], hasHydrated: true });
      return;
    }
    const uid = session.user.id;
    const [followerRows, followingRows] = await Promise.all([
      supabase.from('followers').select('follower:profiles!followers_follower_id_fkey(id, full_name, avatar_url, city)').eq('following_id', uid),
      supabase.from('followers').select('followee:profiles!followers_following_id_fkey(id, full_name, avatar_url, city)').eq('follower_id', uid),
    ]);
    const followers = (followerRows.data ?? []).map((r: any) => toPerson(r.follower)).filter(Boolean);
    const following = (followingRows.data ?? []).map((r: any) => toPerson(r.followee)).filter(Boolean);
    set({ followers, following, followingIds: new Set(following.map((p) => p.id)), hasHydrated: true });
  },
  reset: () => set({ followingIds: new Set(), pendingIds: new Set(), followers: [], following: [], hasHydrated: false }),
}));

// Keyed on profile.id, not session.user.id — see store/myListings.ts for why.
let lastUserId: string | null = null;
let followersRealtimeChannel: RealtimeChannel | null = null;
useAuthStore.subscribe((state) => {
  const uid = state.profile?.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;

  if (followersRealtimeChannel) {
    supabase.removeChannel(followersRealtimeChannel);
    followersRealtimeChannel = null;
  }

  if (uid) {
    useFollowStore.getState().load();
    // Keeps this device's followers/following lists (and any screen reading
    // followingIds/followers.length) in sync with follow/unfollow actions
    // taken from other devices or by other users, without a manual refresh.
    followersRealtimeChannel = supabase
      .channel(`followers-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'followers', filter: `following_id=eq.${uid}` }, () => useFollowStore.getState().load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'followers', filter: `follower_id=eq.${uid}` }, () => useFollowStore.getState().load())
      .subscribe();
  } else {
    useFollowStore.getState().reset();
  }
});

// Coming back to the app after it sat in the background: realtime may have dropped while suspended, so re-read.
AppState.addEventListener('change', (next) => {
  if (next === 'active' && useAuthStore.getState().profile) useFollowStore.getState().load();
});
