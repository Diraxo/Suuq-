'use client';

import { useSyncExternalStore } from 'react';
import { createRefreshController } from '@/lib/refreshController';
import { homeFeed } from '@/store/homeFeed';
import { reloadLocationDirectory } from '@/services/locations';
import { homeBrowse } from '@/store/homeBrowse';

// The one Home refresh pipeline on web, same controller as mobile
// (lib/refreshController.ts). The visible Refresh button and Retry call
// refreshHome(): refetch the first page of the feed and the location
// directory, keeping every selection. The Home tab-bar button, when already on
// Home, calls homeRefresh.onHomeTabPress(true): default selections, scroll to
// top, then the same refetch. Every Home visit revalidates the feed it is
// showing (the directory loads itself on mount). Overlapping triggers share one
// in-flight request. The feed lives in a module-level store (store/homeFeed.ts,
// not in the page), so a refresh that finishes after navigating away and back
// still lands in the page that is showing. Theme, auth and navigation state are
// untouched.
export const homeRefresh = createRefreshController();

// The feed ignores a response to a superseded or timed-out request itself (lib/pagedFeed.ts).
homeRefresh.setRunner(async () => (homeFeed.getQuery() === null ? true : homeFeed.refresh())); // nothing to fetch (Nearby with no place yet) is not a failure

export function useHomeRefresh() {
  return useSyncExternalStore(homeRefresh.subscribe, homeRefresh.getState, homeRefresh.getState);
}

homeRefresh.setResetHandler(() => {
  homeBrowse.getState().reset();
  reloadLocationDirectory();
});

/** Refresh button / Retry: feed + location directory, selections untouched. */
export function refreshHome() {
  reloadLocationDirectory();
  return homeRefresh.refresh();
}
