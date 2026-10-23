'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { STOREFRONTS_ENABLED } from '@/lib/storefrontFlag';
import { isStorefrontId } from '@/lib/storefront';

export type PublicStorefront = { id: string; verified: boolean };

/** A user's PUBLISHED storefront with its staff-set verified flag (public_storefronts), or null. Null while the feature flag is off or the lookup fails. */
export function usePublicStorefront(ownerId: string | undefined): PublicStorefront | null {
  // Keyed by owner so a result for one seller is never shown for another while the next lookup is in flight.
  const [found, setFound] = useState<{ ownerId: string; storefront: PublicStorefront } | null>(null);
  useEffect(() => {
    if (!STOREFRONTS_ENABLED || !isStorefrontId(ownerId)) return;
    let cancelled = false;
    void supabase
      .from('public_storefronts')
      .select('id, verified')
      .eq('owner_id', ownerId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setFound(data?.id ? { ownerId, storefront: { id: data.id as string, verified: data.verified === true } } : null);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId]);
  return STOREFRONTS_ENABLED && found && found.ownerId === ownerId ? found.storefront : null;
}
