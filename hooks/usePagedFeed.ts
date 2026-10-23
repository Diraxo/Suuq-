import { useEffect, useState, useSyncExternalStore } from 'react';
import { Listing } from '@/types';
import { PagedFeed, createPagedFeed } from '@/lib/pagedFeed';
import { FeedQuery, feedKey } from '@/lib/homeFeedPaging';
import { fetchFeedPage } from '@/lib/homeFeedApi';
import { onListingsChanged } from '@/lib/feedEvents';
import { useVisibilityStore } from '@/store/visibility';

/** Subscribes a component to a paged feed's state. */
export function usePagedFeed<T extends { id: string }, Q>(feed: PagedFeed<T, Q>) {
  return useSyncExternalStore(feed.subscribe, feed.getState, feed.getState);
}

/**
 * A feed owned by one screen (category, city): created with the screen, shows `query` (null = idle), and stays
 * current — listings removed or changed elsewhere in the app, and listings staff restore, update it.
 */
export function useScreenFeed(query: FeedQuery | null): PagedFeed<Listing, FeedQuery> {
  const [feed] = useState(() => createPagedFeed<Listing, FeedQuery>({ keyOf: feedKey, fetchPage: (q, cursor, ctx) => fetchFeedPage(q, cursor, ctx) }));
  const key = query ? feedKey(query) : null;
  useEffect(() => {
    feed.setQuery(query);
    // `query` is fully determined by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, key]);
  useEffect(() => onListingsChanged((c) => (c.type === 'removed' ? feed.remove(c.id) : void feed.refresh())), [feed]);
  const restored = useVisibilityStore((s) => s.restoredNonce);
  useEffect(() => {
    if (restored > 0) void feed.refresh();
  }, [feed, restored]);
  return feed;
}
