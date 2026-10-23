// The currencies on offer for the Price tab (for the browsed category + place), fetched on demand. Identical copy at
// web/src/hooks/usePriceOptions.ts — keep in sync (tests/homeFeedPaging.test.ts fails if they drift); the platform
// supplies the fetcher so the file itself has no platform imports.
import { useEffect, useState } from 'react';
import type { CurrencyOption } from '../lib/homeFeed';

type Fetcher = (categories: string[] | null, scopeId: string | null) => Promise<CurrencyOption[]>;

export function usePriceOptions(enabled: boolean, categories: string[] | null, scopeId: string | null, fetcher: Fetcher, refreshToken: number = 0) {
  const key = JSON.stringify([categories, scopeId]);
  const [retryNonce, setRetryNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; options: CurrencyOption[] | null } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetcher(categories, scopeId)
      .then((options) => {
        if (live) setResult({ key, options });
      })
      .catch(() => {
        if (live) setResult({ key, options: null });
      });
    return () => {
      live = false;
    };
    // `categories` and `scopeId` are fully determined by `key`; `fetcher` is a module-level function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, refreshToken, retryNonce]);

  // An answer for different categories/place is not an answer for this one.
  const current = enabled && result && result.key === key ? result : null;
  return { options: current?.options ?? null, failed: !!current && current.options === null, retry: () => setRetryNonce((n) => n + 1) };
}
