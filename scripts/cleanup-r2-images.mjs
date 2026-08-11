// Finds and cleans up listing/profile/message rows that reference a
// corrupt Cloudflare R2 image object — most commonly the silent 0-byte PUT
// bug fixed in lib/r2.ts (uploadToR2 previously had no way to detect a
// request that went out with an empty body; R2 still returned 200 for it).
// Those rows never self-heal: the DB keeps pointing at a dead object
// forever, so the app just keeps showing the "photo unavailable" fallback
// (see ListingCard's onError handler) every time it renders.
//
// Dry-run by default — prints what it *would* change. Pass --apply to
// actually write. Pass --delete-r2 (with --apply) to also purge the dead
// objects from the bucket, which needs R2 credentials and the optional
// `aws4fetch` package (npm install --save-dev aws4fetch).
//
// Requires SUPABASE_SERVICE_ROLE_KEY — this bypasses RLS on purpose (the
// whole point is to fix rows the script doesn't "own" as any particular
// user) so it must only ever be run from a trusted machine, never shipped
// in the app. Get it from Supabase dashboard → Project Settings → API.
//
// Usage:
//   node ./scripts/cleanup-r2-images.mjs                       # report only
//   node ./scripts/cleanup-r2-images.mjs --apply                # fix DB rows
//   node ./scripts/cleanup-r2-images.mjs --apply --delete-r2    # + purge R2

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
  console.error('pass it inline instead of committing it: SUPABASE_SERVICE_ROLE_KEY=... node ./scripts/cleanup-r2-images.mjs');
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
      return res.ok || res.status === 404;
    },
  };
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Only Cloudflare R2 objects can go corrupt this way — legacy Cloudinary
// URLs (still-live rows from before the R2 migration) and mock
// picsum.photos seed images are never affected, so skip them entirely.
function isR2Url(url) {
  return typeof url === 'string' && url.length > 0 && !url.includes('res.cloudinary.com') && !url.includes('picsum.photos');
}

// A definite verdict only for the two unambiguous signatures of a dead
// object: HTTP 200 with Content-Length 0 (the silent-empty-PUT bug this
// cleans up), or HTTP 404 (object genuinely gone). Anything else — a
// transient network error, a redirect, a 5xx — comes back 'unknown' and is
// left untouched, so a flaky check can never delete a perfectly good photo.
async function checkUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (res.status === 404) return 'missing';
    if (res.ok && res.headers.get('content-length') === '0') return 'corrupt';
    return res.ok ? 'ok' : 'unknown';
  } catch {
    return 'unknown';
  }
}

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

const stats = { checked: 0, dead: 0, fixed: 0, skippedAllPhotosDead: 0, r2Deleted: 0, r2DeleteFailed: 0 };
const keysToDelete = [];

async function cleanupArrayColumn({ table, idCol = 'id', urlCol, keyCol, minKeep, extraCols = [] }) {
  const { data, error } = await supabase.from(table).select([idCol, urlCol, keyCol, ...extraCols].join(', '));
  if (error) {
    console.error(`Failed to read ${table}.${urlCol}:`, error.message);
    return;
  }

  for (const row of data) {
    const urls = row[urlCol] ?? [];
    const keys = row[keyCol] ?? [];
    if (urls.length === 0) continue;
    const indices = urls.map((_, i) => i).filter((i) => isR2Url(urls[i]));
    if (indices.length === 0) continue;

    stats.checked += indices.length;
    const verdicts = await mapWithConcurrency(indices, CONCURRENCY, (i) => checkUrl(urls[i]));
    const deadIndices = indices.filter((i, n) => verdicts[n] === 'corrupt' || verdicts[n] === 'missing');
    if (deadIndices.length === 0) continue;
    stats.dead += deadIndices.length;

    const requiredMin = typeof minKeep === 'function' ? minKeep(row) : minKeep;
    if (urls.length - deadIndices.length < requiredMin) {
      console.log(`[${table}:${row[idCol]}] removing all dead photo(s) would leave the row empty — skipping, not auto-removing.`);
      stats.skippedAllPhotosDead++;
      continue;
    }

    const deadSet = new Set(deadIndices);
    const newUrls = urls.filter((_, i) => !deadSet.has(i));
    const newKeys = keys.filter((_, i) => !deadSet.has(i));
    console.log(`[${table}:${row[idCol]}] removing ${deadIndices.length}/${urls.length} dead photo(s)${APPLY ? '' : ' (dry run)'}`);
    deadIndices.forEach((i) => urls[i] && console.log(`    ${urls[i]}`));

    if (APPLY) {
      const { error: updateError } = await supabase.from(table).update({ [urlCol]: newUrls, [keyCol]: newKeys }).eq(idCol, row[idCol]);
      if (updateError) {
        console.error(`  update failed:`, updateError.message);
        continue;
      }
      stats.fixed += deadIndices.length;
      deadIndices.forEach((i) => keys[i] && keysToDelete.push(keys[i]));
    }
  }
}

async function cleanupSingleColumn({ table, idCol = 'id', urlCol, keyCol }) {
  const { data, error } = await supabase.from(table).select(`${idCol}, ${urlCol}, ${keyCol}`).not(urlCol, 'is', null);
  if (error) {
    console.error(`Failed to read ${table}.${urlCol}:`, error.message);
    return;
  }

  for (const row of data) {
    const url = row[urlCol];
    if (!isR2Url(url)) continue;

    stats.checked++;
    const verdict = await checkUrl(url);
    if (verdict !== 'corrupt' && verdict !== 'missing') continue;
    stats.dead++;

    console.log(`[${table}:${row[idCol]}] ${urlCol} is dead${APPLY ? '' : ' (dry run)'}`);
    console.log(`    ${url}`);

    if (APPLY) {
      const { error: updateError } = await supabase.from(table).update({ [urlCol]: null, [keyCol]: null }).eq(idCol, row[idCol]);
      if (updateError) {
        console.error(`  update failed:`, updateError.message);
        continue;
      }
      stats.fixed++;
      if (row[keyCol]) keysToDelete.push(row[keyCol]);
    }
  }
}

await cleanupArrayColumn({ table: 'listings', urlCol: 'images', keyCol: 'image_public_ids', minKeep: 1 });
// messages_check requires text OR images OR deleted_at (0023_chat_supabase_native.sql)
// — this script never sets deleted_at, so a message with no text must keep at least 1 image.
await cleanupArrayColumn({
  table: 'messages',
  urlCol: 'images',
  keyCol: 'image_keys',
  extraCols: ['text'],
  minKeep: (row) => (row.text && row.text.trim().length > 0 ? 0 : 1),
});
await cleanupSingleColumn({ table: 'profiles', urlCol: 'avatar_url', keyCol: 'avatar_public_id' });
await cleanupSingleColumn({ table: 'profiles', urlCol: 'business_logo_url', keyCol: 'business_logo_public_id' });
await cleanupSingleColumn({ table: 'profiles', urlCol: 'business_banner_url', keyCol: 'business_banner_public_id' });

if (APPLY && DELETE_R2 && keysToDelete.length > 0) {
  console.log(`\nPurging ${keysToDelete.length} dead object(s) from R2...`);
  const results = await mapWithConcurrency(keysToDelete, CONCURRENCY, (key) => r2Client.delete(key));
  results.forEach((ok) => (ok ? stats.r2Deleted++ : stats.r2DeleteFailed++));
}

console.log('\n--- summary ---');
console.log(`checked:                 ${stats.checked}`);
console.log(`dead (corrupt/missing):  ${stats.dead}`);
console.log(`db rows fixed:           ${stats.fixed}${APPLY ? '' : ' (dry run — nothing written)'}`);
console.log(`skipped (all photos dead, needs manual re-upload): ${stats.skippedAllPhotosDead}`);
if (APPLY && DELETE_R2) {
  console.log(`r2 objects deleted:      ${stats.r2Deleted}`);
  console.log(`r2 deletes failed:       ${stats.r2DeleteFailed}`);
}
if (!APPLY && stats.dead > 0) {
  console.log('\nDry run only. Re-run with --apply to write these changes (add --delete-r2 to also purge the dead R2 objects).');
}
