'use client';

import { useEffect, useRef } from 'react';
import { Button } from './Button';

// Under the last row of a paginated listing grid: loads the next page when it scrolls into view, shows progress, a
// quiet retry if a page failed (the rows stay), and a short end note on the last page.
export function FeedFooter({
  count,
  loadingMore,
  moreFailed,
  hasMore,
  ready,
  onLoadMore,
}: {
  count: number;
  loadingMore: boolean;
  moreFailed: boolean;
  hasMore: boolean;
  ready: boolean;
  onLoadMore: () => void;
}) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    // A failed page is retried by the button, never by scrolling (that would loop on an outage).
    if (!el || moreFailed || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onLoadMore(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [onLoadMore, moreFailed, count, hasMore, loadingMore]);

  if (count === 0) return null;
  return (
    <>
      {hasMore && <div ref={sentinel} className="h-8" />}
      {loadingMore && (
        <p className="py-4 text-center text-sm text-textSecondary" role="status">
          Loading more…
        </p>
      )}
      {moreFailed && !loadingMore && (
        <div className="flex flex-col items-center gap-2 py-4" role="status">
          <p className="text-sm text-textSecondary">Couldn&apos;t load more listings.</p>
          <Button variant="outline" size="sm" onClick={onLoadMore}>
            Try again
          </Button>
        </div>
      )}
      {!hasMore && ready && <p className="py-6 text-center text-xs text-textSecondary">You&apos;ve seen everything here</p>}
      {hasMore && !loadingMore && !moreFailed && (
        <div className="flex justify-center py-2">
          <Button variant="ghost" size="sm" onClick={onLoadMore}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}
