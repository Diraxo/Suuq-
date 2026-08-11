// Deletes all listings and chat data (conversations, messages, offers,
// price drops, view events, and the favorites/recently_viewed/reports rows
// that reference those listings by plain text id) while leaving profiles,
// avatars, and business profile fields untouched.
//
// Dry-run by default — prints counts only, writes nothing. Pass --apply to
// actually delete DB rows. Pass --delete-r2 (with --apply) to also purge the
// associated Cloudflare R2 objects (listing photos + chat image
// attachments) directly from the bucket — this needs R2 credentials and the
// optional `aws4fetch` package (npm install --save-dev aws4fetch).
//
// Requires SUPABASE_SERVICE_ROLE_KEY — this bypasses RLS on purpose (a
// cross-user admin cleanup) so it must only ever be run from a trusted
// machine, never shipped in the app. Get it from Supabase dashboard →
// Project Settings → API.
//
// Usage:
//   node ./scripts/cleanup-test-data.mjs                        # dry run report only
//   node ./scripts/cleanup-test-data.mjs --apply                # delete DB rows
//   node ./scripts/cleanup-test-data.mjs --apply --delete-r2    # + purge R2 objects

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const DELETE_R2 = args.has('--delete-r2');
const CONCURRENCY = 6;

function loadEnv() {
  const envPath = new URL('../.env', import.meta.url);
  const fromFile = existsSync(envPath)
    ? Object.fromEntries(
        readFileSync(envPath, 'utf8')
          .split('\n')
          .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
          .map((l) => {
            const idx = l.indexOf('=');
            return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
          })
      )
    : {};
  return { ...fromFile, ...process.env };
}

const env = loadEnv();
const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('SUPABASE_SERVICE_ROLE_KEY is not in .env by default (dashboard → Project Settings → API) —');
  console.error('pass it inline instead of committing it: SUPABASE_SERVICE_ROLE_KEY=... node ./scripts/cleanup-test-data.mjs');
  process.exit(1);
}

let r2Client = null;
if (DELETE_R2) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    console.error('--delete-r2 needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME set.');
    process.exit(1);
  }
  let AwsClient;
  try {
    ({ AwsClient } = await import('aws4fetch'));
  } catch {
    console.error('--delete-r2 needs the aws4fetch package: npm install --save-dev aws4fetch');
    process.exit(1);
  }
  const client = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
  const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  r2Client = {
    async delete(key) {
      const signed = await client.sign(`${endpoint}/${R2_BUCKET_NAME}/${key}`, { method: 'DELETE' });
      const res = await fetch(signed);
      return res.ok || res.status === 404; // idempotent
    },
  };
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const { data: listings, error: listingsErr } = await supabase.from('listings').select('id, images, image_public_ids');
  if (listingsErr) throw new Error(`listings select failed: ${listingsErr.message}`);
  const listingIds = listings.map((l) => l.id);
  const listingIdSet = new Set(listingIds);
  const listingImageKeys = listings.flatMap((l) => l.image_public_ids || []).filter(Boolean);
  const listingImageCount = listings.reduce((n, l) => n + (l.images || []).length, 0);

  const { count: conversationCount, error: convErr } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true });
  if (convErr) throw new Error(`conversations count failed: ${convErr.message}`);

  const { data: messages, error: messagesErr } = await supabase.from('messages').select('id, images, image_keys');
  if (messagesErr) throw new Error(`messages select failed: ${messagesErr.message}`);
  const messageImageKeys = messages.flatMap((m) => m.image_keys || []).filter(Boolean);
  const messageImageCount = messages.reduce((n, m) => n + (m.images || []).length, 0);

  const { count: profileCount, error: profErr } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
  if (profErr) throw new Error(`profiles count failed: ${profErr.message}`);
  const { count: avatarCount, error: avatarErr } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .not('avatar_url', 'is', null);
  if (avatarErr) throw new Error(`avatar count failed: ${avatarErr.message}`);
  const { count: businessCount, error: bizErr } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .not('business_name', 'is', null);
  if (bizErr) throw new Error(`business profile count failed: ${bizErr.message}`);

  // favorites.listing_id / recently_viewed.listing_id / reports.target_id are
  // plain text (not FKs — they can also point at the static mock catalogue),
  // so deleting listings won't cascade to them. Clean up matches explicitly.
  const { data: favorites, error: favErr } = await supabase.from('favorites').select('id, listing_id');
  if (favErr) throw new Error(`favorites select failed: ${favErr.message}`);
  const favoritesToDelete = (favorites || []).filter((f) => listingIdSet.has(f.listing_id));

  const { data: recentlyViewed, error: rvErr } = await supabase.from('recently_viewed').select('id, listing_id');
  if (rvErr) throw new Error(`recently_viewed select failed: ${rvErr.message}`);
  const recentlyViewedToDelete = (recentlyViewed || []).filter((r) => listingIdSet.has(r.listing_id));

  const { data: reports, error: repErr } = await supabase
    .from('reports')
    .select('id, target_id')
    .eq('target_type', 'listing');
  if (repErr) throw new Error(`reports select failed: ${repErr.message}`);
  const reportsToDelete = (reports || []).filter((r) => listingIdSet.has(r.target_id));

  const r2Keys = [...listingImageKeys, ...messageImageKeys];

  console.log('--- DRY RUN REPORT ---');
  console.log(`Listings found: ${listings.length}`);
  console.log(`Listing images found: ${listingImageCount}`);
  console.log(`Chat conversations found: ${conversationCount ?? 0}`);
  console.log(`Chat messages found: ${messages.length}`);
  console.log(`Chat image attachments found: ${messageImageCount}`);
  console.log(`R2 listing objects found: ${listingImageKeys.length}`);
  console.log(`R2 chat image objects found: ${messageImageKeys.length}`);
  console.log('');
  console.log(`Profiles that will remain: ${profileCount ?? 0}`);
  console.log(`Profile/avatar images that will remain: ${avatarCount ?? 0}`);
  console.log(`Business profiles that will remain: ${businessCount ?? 0}`);
  console.log('');
  console.log(
    `Also removing (not FK-cascaded, referenced by plain-text listing id): ` +
      `${favoritesToDelete.length} favorites, ${recentlyViewedToDelete.length} recently_viewed, ${reportsToDelete.length} reports`
  );
  console.log(
    'conversation_participants, message_reactions, offers, price_drops, and listing_view_events cascade automatically via FK when their listing/conversation/message is deleted.'
  );

  if (!APPLY) {
    console.log('\nDry run only — nothing deleted. Re-run with --apply to delete (add --delete-r2 to also purge R2 objects).');
    return;
  }

  console.log(`\nApplying deletion${DELETE_R2 ? ' (including R2 purge)' : ''}...`);

  if (DELETE_R2 && r2Keys.length > 0) {
    console.log(`Purging ${r2Keys.length} R2 object(s)...`);
    const results = await mapWithConcurrency(r2Keys, CONCURRENCY, (key) => r2Client.delete(key));
    const ok = results.filter(Boolean).length;
    console.log(`R2 objects deleted: ${ok}/${r2Keys.length}`);
    if (ok < r2Keys.length) console.error(`${r2Keys.length - ok} R2 delete(s) failed — check bucket manually.`);
  }

  if (favoritesToDelete.length > 0) {
    const { error } = await supabase.from('favorites').delete().in('id', favoritesToDelete.map((f) => f.id));
    if (error) console.error('favorites delete failed:', error.message);
  }
  if (recentlyViewedToDelete.length > 0) {
    const { error } = await supabase.from('recently_viewed').delete().in('id', recentlyViewedToDelete.map((r) => r.id));
    if (error) console.error('recently_viewed delete failed:', error.message);
  }
  if (reportsToDelete.length > 0) {
    const { error } = await supabase.from('reports').delete().in('id', reportsToDelete.map((r) => r.id));
    if (error) console.error('reports delete failed:', error.message);
  }

  if (listingIds.length > 0) {
    const { error } = await supabase.from('listings').delete().in('id', listingIds);
    if (error) console.error('listings delete failed:', error.message);
  }

  console.log('\n--- VERIFICATION ---');
  const { count: listingsAfter } = await supabase.from('listings').select('id', { count: 'exact', head: true });
  const { count: conversationsAfter } = await supabase.from('conversations').select('id', { count: 'exact', head: true });
  const { count: messagesAfter } = await supabase.from('messages').select('id', { count: 'exact', head: true });
  const { count: profilesAfter } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
  const { count: avatarsAfter } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .not('avatar_url', 'is', null);
  console.log(`Listings remaining: ${listingsAfter} (expect 0)`);
  console.log(`Conversations remaining: ${conversationsAfter} (expect 0)`);
  console.log(`Messages remaining: ${messagesAfter} (expect 0)`);
  console.log(`Profiles remaining: ${profilesAfter} (expect ${profileCount ?? 0}, unchanged)`);
  console.log(`Profiles with avatar remaining: ${avatarsAfter} (expect ${avatarCount ?? 0}, unchanged)`);
}

await main();
