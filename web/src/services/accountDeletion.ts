// Reuses the exact same `delete-account` Edge Function the mobile app calls
// (lib/accountDeletion.ts) — no separate web deletion path, no data left
// behind. Service-role work (R2 cleanup, auth.users hard delete + FK
// cascades) all happens server-side in the shared function.
import { supabase } from '@/lib/supabase';

export async function deleteAccount(): Promise<{ error?: string }> {
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) return { error: error.message };
  return {};
}
