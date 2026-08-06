import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = Object.fromEntries(
  envText
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const url = env.EXPO_PUBLIC_SUPABASE_URL;
const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

console.log('URL:', url);

const supabase = createClient(url, key);

const { error } = await supabase.auth.getSession();
if (error) {
  console.error('auth.getSession failed:', error.message);
  process.exit(1);
}
console.log('auth.getSession: OK (client can reach GoTrue config, no active session as expected)');

const res = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
console.log('REST root status:', res.status);
const body = await res.text();
console.log('REST root body (truncated):', body.slice(0, 300));
