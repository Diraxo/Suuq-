import { Listing } from '@/types';
import { createPagedFeed } from '@/lib/pagedFeed';
import { FeedQuery, feedKey } from '@/lib/homeFeedPaging';
import { fetchFeedPage } from '@/lib/homeFeedApi';
import { onListingsChanged } from '@/lib/feedEvents';
import { useVisibilityStore } from '@/store/visibility';
import { useAuthStore } from '@/store/auth';
import { useBlockedUsersStore } from '@/store/blockedUsers';
import { prefetchStartupCovers } from '@/lib/imagePrefetch';

// Home's feed: one page at a time from the server (lib/homeFeedApi.ts), kept outside the screen so it survives
// navigating away and back (arriving at Home from another tab shows it as it was left). The Home screen tells it
// WHICH feed to show (setQuery) from the browsing selections; pull-to-refresh and the tab re-tap go through
// store/homeRefresh.ts, which calls homeFeed.refresh().
export const homeFeed = createPagedFeed<Listing, FeedQuery>({ keyOf: feedKey, fetchPage: (q, cursor, ctx) => fetchFeedPage(q, cursor, ctx) });

// As soon as a page of the feed arrives (before the list has laid out and reported what is visible), start the first covers downloading
// through the shared image queue. Not awaited by anything: Home never waits for a photo. Only the head of the list changes this.
let warmedHead = '';
homeFeed.subscribe(() => {
  const items = homeFeed.getState().items;
  const head = items.slice(0, 6).map((l) => l.images[0] ?? '').join('|');
  if (!head || head === warmedHead) return;
  warmedHead = head;
  prefetchStartupCovers(items.map((l) => l.images[0]), 6);
});

// Staying current without downloading everything again: a listing removed locally (staff action, own delete)
// disappears at once; any other local change (publish, edit, sale, price drop, restore) refetches page 1.
onListingsChanged((change) => {
  if (change.type === 'removed') homeFeed.remove(change.id);
  else void homeFeed.refresh({ keepLoaded: true });
});
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
let feedViewerId = useAuthStore.getState().profile?.id ?? null;
useAuthStore.subscribe((s) => {
  const id = s.profile?.id ?? null;
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
