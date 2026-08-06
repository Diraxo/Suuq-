import { StreamChat } from 'stream-chat';
import { supabase } from '@/lib/supabase';
import { Profile } from '@/types';

// Single Stream Chat client for the app's lifetime — connect/disconnect the
// active user on it as auth state changes (store/auth.ts), same pattern as
// the Supabase client itself. Never construct a token client-side: every
// token comes from the stream-token edge function, which is the only place
// that holds STREAM_API_SECRET.

const apiKey = process.env.EXPO_PUBLIC_STREAM_API_KEY;
if (!apiKey) {
  throw new Error('Missing EXPO_PUBLIC_STREAM_API_KEY. Set it in .env.');
}

export const streamClient = StreamChat.getInstance(apiKey);

async function fetchStreamToken(): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ token: string }>('stream-token');
  if (error || !data?.token) {
    throw new Error(error?.message ?? 'Could not fetch Stream Chat token');
  }
  return data.token;
}

let connectedUserId: string | null = null;

/** Call once a Supabase session exists (login, app-start-with-session). Safe to call repeatedly. */
export async function connectStreamUser(userId: string, profile: Profile | null) {
  if (connectedUserId === userId) return;
  if (streamClient.userID && streamClient.userID !== userId) {
    await streamClient.disconnectUser();
  }
  await streamClient.connectUser(
    {
      id: userId,
      name: profile?.full_name ?? 'Suuq+ user',
      image: profile?.avatar_url ?? undefined,
    },
    fetchStreamToken
  );
  connectedUserId = userId;
}

// Best-effort push of the current user's name/avatar to Stream right after an
// Edit Profile save, so open chat screens reflect it without waiting for the
// next connectUser() (app relaunch/re-login). Stream's default "user" role
// permits updating one's own user object, so this doesn't need a server call.
export async function syncStreamUserProfile(userId: string, profile: Profile | null) {
  if (connectedUserId !== userId) return;
  try {
    await streamClient.upsertUser({
      id: userId,
      name: profile?.full_name ?? 'Suuq+ user',
      image: profile?.avatar_url ?? undefined,
    });
  } catch (err) {
    if (__DEV__) console.log('[stream] profile sync failed:', err);
  }
}

/** Call on sign-out. */
export async function disconnectStreamUser() {
  if (!connectedUserId) return;
  connectedUserId = null;
  await streamClient.disconnectUser();
}
