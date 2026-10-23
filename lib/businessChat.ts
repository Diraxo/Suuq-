import { supabase } from '@/lib/supabase';

/**
 * Opens (or reuses) a direct conversation with a business, for when there is no listing to talk about.
 * Needs migration 0066; until it is applied the RPC does not exist and this resolves to null.
 */
export async function startBusinessConversation(businessId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('start_business_conversation', { p_business_id: businessId });
  if (error || !data) return null;
  return (data as { id: string }).id;
}
