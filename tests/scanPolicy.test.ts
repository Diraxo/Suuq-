import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { listingPresignGate, readClosedFlag, isListingFolder } from '../supabase/functions/_shared/scanPolicy';
import { isAllowedFolder } from '../supabase/functions/_shared/uploadPaths';

const U = '11111111-1111-4111-8111-111111111111';
const root = path.join(__dirname, '..', '..');

test('open flag: listing uploads work exactly as today', () => {
  assert.deepEqual(listingPresignGate(`listings/${U}/123`, false), { allow: true });
});

test('closed flag: every listings/ folder is refused with a structured "update required" answer', () => {
  for (const f of [`listings/${U}`, `listings/${U}/draft-1`]) {
    const g = listingPresignGate(f, true);
    assert.equal(g.allow, false);
    if (!g.allow) assert.deepEqual([g.status, g.code], [426, 'update_required']);
  }
});

test('closed flag never affects avatars or business images', () => {
  for (const f of [`avatars/${U}`, `business/${U}/logo`, `business/${U}/banner`]) assert.deepEqual(listingPresignGate(f, true), { allow: true });
});

test('an unreadable flag refuses listing uploads with a retryable 503 — never silently opens', () => {
  const g = listingPresignGate(`listings/${U}`, null);
  assert.equal(g.allow, false);
  if (!g.allow) assert.deepEqual([g.status, g.code], [503, 'policy_unavailable']);
  assert.deepEqual(listingPresignGate(`avatars/${U}`, null), { allow: true }, 'but other folders keep working');
});

test('reading the flag: true/false pass through; a missing function (0050 not applied) means open; other errors mean unknown', () => {
  assert.equal(readClosedFlag({ data: true, error: null }), true);
  assert.equal(readClosedFlag({ data: false, error: null }), false);
  assert.equal(readClosedFlag({ data: null, error: { code: '42883', message: 'function public.legacy_presign_closed() does not exist' } }), false);
  assert.equal(readClosedFlag({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.legacy_presign_closed' } }), false);
  assert.equal(readClosedFlag({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }), null);
  assert.equal(readClosedFlag({ data: 'weird', error: null }), null);
  assert.equal(readClosedFlag({ data: null, error: null }), null);
});

test('folder detection matches exactly what isAllowedFolder lets through for listings; wm/ can never be requested', () => {
  assert.equal(isListingFolder(`listings/${U}`), true);
  assert.equal(isListingFolder(`avatars/${U}`), false);
  assert.equal(isListingFolder('wm/listings/x'), false);
  assert.equal(isAllowedFolder(`wm/listings/${U}/x`, U), false);
  assert.equal(isAllowedFolder(`wm/listings/${U}`, U), false);
  assert.equal(isAllowedFolder('wm', U), false);
  assert.equal(isAllowedFolder('orig', U), false);
  assert.equal(isAllowedFolder(`pending/wm/listings/${U}`, U), false);
});

test('r2-presign actually consults the gate BEFORE signing anything, and after the ownership check', () => {
  const src = fs.readFileSync(path.join(root, 'supabase/functions/r2-presign/index.ts'), 'utf8');
  const own = src.indexOf('isAllowedFolder(folder, user.id)');
  const gate = src.indexOf('listingPresignGate(');
  const sign = src.indexOf('presignPut(client');
  assert.ok(own > 0 && gate > own && sign > gate, 'order must be: ownership → policy gate → sign');
  assert.ok(/rpc\('legacy_presign_closed'\)/.test(src));
});
