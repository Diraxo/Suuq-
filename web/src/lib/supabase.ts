import { createClient } from '@supabase/supabase-js';

// Same Supabase project the mobile app uses (lib/supabase.ts there) — same
// database, same auth users, same RLS. Session persists to localStorage
// (the browser equivalent of the mobile app's AsyncStorage) and
// detectSessionInUrl completes the Google OAuth PKCE redirect automatically
// when the browser lands back on the app with a `?code=` param, so no
// separate server callback route is needed for this client-rendered app.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in web/.env.local.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});
