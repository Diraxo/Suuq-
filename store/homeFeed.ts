import { Listing } from '@/types';
import { createPagedFeed } from '@/lib/pagedFeed';
import { FeedQuery, feedKey } from '@/lib/homeFeedPaging';
import { fetchFeedPage } from '@/lib/homeFeedApi';
import { onListingsChanged } from '@/lib/feedEvents';
import { useVisibilityStore } from '@/store/visibility';

// Home's feed: one page at a time from the server (lib/homeFeedApi.ts), kept outside the screen so it survives
// navigating away and back (arriving at Home from another tab shows it as it was left). The Home screen tells it
// WHICH feed to show (setQuery) from the browsing selections; pull-to-refresh and the tab re-tap go through
// store/homeRefresh.ts, which calls homeFeed.refresh().
export const homeFeed = createPagedFeed<Listing, FeedQuery>({ keyOf: feedKey, fetchPage: (q, cursor, ctx) => fetchFeedPage(q, cursor, ctx) });

// Staying current without downloading everything again: a listing removed locally (staff action, own delete)
// disappears at once; any other local change (publish, edit, sale, price drop, restore) refetches page 1.
onListingsChanged((change) => {
  if (change.type === 'removed') homeFeed.remove(change.id);
  else void homeFeed.refresh();
});
// A listing that became visible again (staff restore) is not in any list yet.
let lastRestored = useVisibilityStore.getState().restoredNonce;
useVisibilityStore.subscribe((s) => {
  if (s.restoredNonce === lastRestored) return;
  lastRestored = s.restoredNonce;
  void homeFeed.refresh();
});
