'use client';

import { Listing } from '@/lib/types';
import { createPagedFeed } from '@/lib/pagedFeed';
import { FeedQuery, feedKey } from '@/lib/homeFeedPaging';
import { fetchFeedPage } from '@/services/homeFeed';
import { useVisibilityStore } from '@/store/visibility';
import { useAuthStore } from '@/store/auth';
import { useBlockedUsersStore } from '@/store/blockedUsers';

// Home's feed: one page at a time from the server, kept outside the page so it survives navigating away and back
// (same idea as store/homeBrowse.ts and the app's store/homeFeed.ts). The page tells it WHICH feed to show
// (setQuery) from the browsing selections; Refresh / Retry / the Home tab go through store/homeRefresh.ts.
export const homeFeed = createPagedFeed<Listing, FeedQuery>({ keyOf: feedKey, fetchPage: (q, cursor, ctx) => fetchFeedPage(q, cursor, ctx) });

// A listing that became visible again (staff restore) is not in any list yet.
let lastRestored = useVisibilityStore.getState().restoredNonce;
useVisibilityStore.subscribe((s) => {
  if (s.restoredNonce === lastRestored) return;
  lastRestored = s.restoredNonce;
  void homeFeed.refresh({ keepLoaded: true });
});

// The server answers per viewer (blocks hide a seller's listings, in both directions), but this list outlives the
// screen. So it must be fetched again whenever the viewer changes (sign-in, sign-out, account switch) or finishes
// a block/unblock — otherwise the previous viewer's filtered result stays on screen until the app is reloaded.
let feedViewerId = useAuthStore.getState().session?.user.id ?? null;
useAuthStore.subscribe((s) => {
  const id = s.session?.user.id ?? null;
  if (id === feedViewerId) return;
  feedViewerId = id;
  void homeFeed.refresh();
});
let feedBlockVersion = useBlockedUsersStore.getState().version;
useBlockedUsersStore.subscribe((s) => {
  if (s.version === feedBlockVersion) return;
  feedBlockVersion = s.version;
  void homeFeed.refresh();
});
