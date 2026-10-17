import { createRefreshController } from '@/lib/refreshController';
import { homeFeed } from '@/store/homeFeed';
import { useLocationsStore } from '@/store/locations';
import { homeBrowse } from '@/store/homeBrowse';

// The one Home refresh pipeline on mobile. Two actions share it:
//  - pull-to-refresh and the in-screen Retry call homeRefresh.refresh(): refetch
//    the live data (the first page of the feed, and the location directory)
//    and keep every selection.
//  - tapping the already-active Home tab calls homeRefresh.onHomeTabPress(true),
//    i.e. reset(): default category/place/price order/tab, scroll to top, then
//    the same refresh. Browsing state only — no listing or account data changes.
// Overlapping triggers share a single in-flight request.
export const homeRefresh = createRefreshController();

// Both loads are newest-wins inside their stores, so a request that timed out
// (see REFRESH_TIMEOUT_MS) cannot commit over the result of the Retry. The feed
// refetches only its FIRST page (the rows being shown are replaced when it lands);
// it never downloads the whole catalogue.
homeRefresh.setRunner(async () => {
  // Nothing to fetch (Nearby with no place yet) is not a failure.
  const [ok] = await Promise.all([homeFeed.getQuery() === null ? true : homeFeed.refresh(), useLocationsStore.getState().load({ force: true }).catch(() => {})]);
  return ok;
});

homeRefresh.setResetHandler(() => homeBrowse.getState().reset());
