'use client';

import { Listing } from '@/lib/types';
import { createPagedFeed } from '@/lib/pagedFeed';
import { FeedQuery, feedKey } from '@/lib/homeFeedPaging';
import { fetchFeedPage } from '@/services/homeFeed';
import { useVisibilityStore } from '@/store/visibility';

// Home's feed: one page at a time from the server, kept outside the page so it survives navigating away and back
// (same idea as store/homeBrowse.ts and the app's store/homeFeed.ts). The page tells it WHICH feed to show
// (setQuery) from the browsing selections; Refresh / Retry / the Home tab go through store/homeRefresh.ts.
export const homeFeed = createPagedFeed<Listing, FeedQuery>({ keyOf: feedKey, fetchPage: (q, cursor, ctx) => fetchFeedPage(q, cursor, ctx) });

// A listing that became visible again (staff restore) is not in any list yet.
let lastRestored = useVisibilityStore.getState().restoredNonce;
useVisibilityStore.subscribe((s) => {
  if (s.restoredNonce === lastRestored) return;
  lastRestored = s.restoredNonce;
  void homeFeed.refresh();
});
