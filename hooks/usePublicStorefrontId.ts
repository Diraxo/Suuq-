import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { STOREFRONTS_ENABLED } from '@/lib/storefrontFlag';
import { isStorefrontId } from '@/lib/storefront';

export type PublicStorefront = { id: string; verified: boolean };

/** A user's PUBLISHED storefront (from public_storefronts) with its staff-set verified flag, or null. Always null while the feature flag is off; a failed lookup is also null. */
export function usePublicStorefront(ownerId: string | undefined): PublicStorefront | null {
  // Keyed by owner so a result fetched for one seller is never shown for another while the next lookup is in flight.
  const [found, setFound] = useState<{ ownerId: string; storefront: PublicStorefront } | null>(null);
  useEffect(() => {
    if (!STOREFRONTS_ENABLED || !isStorefrontId(ownerId)) return;
    let cancelled = false;
    supabase
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

/** The id of a user's PUBLISHED storefront, or null. */
export function usePublicStorefrontId(ownerId: string | undefined): string | null {
  return usePublicStorefront(ownerId)?.id ?? null;
}
