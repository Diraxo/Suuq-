// A phone number is private account data (migration 0072): profiles.phone is always NULL for everyone, and the number is only handed out by
// authorization-checked functions. Nothing here decides who may call — the database does. A client that cannot get a number simply has no
// Call button, so the UI can never show a button the policy would refuse.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/** Where the number is being asked for. The database applies the matching sharing rule (personal vs business) for each. */
export type ContactContext =
  | { kind: 'listing'; listingId: string }
  | { kind: 'chat'; conversationId: string }
  | { kind: 'business_profile' }
  | { kind: 'personal_profile' };

function toArgs(ownerId: string, ctx: ContactContext) {
  const ref = ctx.kind === 'listing' ? ctx.listingId : ctx.kind === 'chat' ? ctx.conversationId : null;
  return { p_owner: ownerId, p_context: ctx.kind, p_ref: ref };
}

/** The number the signed-in viewer may call for this context, or null (not shared, not signed in, blocked, rate limited, or no database support). */
export async function fetchContactPhone(ownerId: string, ctx: ContactContext): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('get_contact_phone', toArgs(ownerId, ctx));
    if (error || typeof data !== 'string') return null;
    return data.trim() || null;
  } catch {
    return null;
  }
}

/** The caller's own number (edit-profile, first-listing phone prompt). Undefined means "could not ask" (database without 0072). */
export async function fetchMyPhone(): Promise<string | null | undefined> {
  try {
    const { data, error } = await supabase.rpc('my_phone');
    if (error) return undefined;
    return typeof data === 'string' && data.trim() ? data.trim() : null;
  } catch {
    return undefined;
  }
}

/** Removes the caller's own number. A NULL profile write is deliberately ignored by the database, so clearing is explicit. */
export async function clearMyPhone(): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('clear_my_phone');
    return !error;
  } catch {
    return false;
  }
}

/**
 * The number to call for one context, or null while loading / when it is not shared. Pass `enabled = false` (own listing, no session,
 * mock data) to skip the request. Re-asks when the owner, the context or `enabled` changes.
 */
export function useContactPhone(ownerId: string | null | undefined, ctx: ContactContext | null, enabled: boolean): string | null {
  const [phone, setPhone] = useState<string | null>(null);
  const key = ctx ? `${ctx.kind}:${ctx.kind === 'listing' ? ctx.listingId : ctx.kind === 'chat' ? ctx.conversationId : ''}` : '';
  useEffect(() => {
    let cancelled = false;
    setPhone(null);
    if (!enabled || !ownerId || !ctx) return;
    fetchContactPhone(ownerId, ctx).then((p) => {
      if (!cancelled) setPhone(p);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ownerId, key]);
  return phone;
}
