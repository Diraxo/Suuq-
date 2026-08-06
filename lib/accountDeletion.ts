import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { disconnectStreamUser } from '@/lib/stream';

// Single choke point for permanent account deletion, used by
// app/settings/delete-account.tsx — mirrors lib/authFlow.ts's shape.
// The delete-account edge function hard-deletes the auth.users row (which
// cascades through every FK'd table) plus best-effort cleans up Cloudinary
// images and the Stream Chat user. Once that succeeds, the server-side user
// no longer exists, so this clears local session state directly rather than
// calling supabase.auth.signOut() (which would just fail against a session
// whose user is already gone).
export async function deleteAccount(): Promise<{ error?: string }> {
  const { data, error } = await supabase.functions.invoke<{ success?: boolean; error?: string }>('delete-account');
  if (error || data?.error) {
    return { error: data?.error ?? error?.message ?? 'Could not delete your account.' };
  }

  await disconnectStreamUser().catch(() => {});
  await supabase.auth.signOut().catch(() => {});
  useAuthStore.setState({ session: null, profile: null });

  return {};
}
