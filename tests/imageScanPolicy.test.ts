import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePublishPath, parsePolicy, reviewPublishAllowed, scanBlockFromDbError, scanBlockFromPresignBody, type ScanClientPolicy } from '../lib/imageScanPolicy';

const P = (mode: ScanClientPolicy['mode'], legacyUploadClosed = false): ScanClientPolicy => ({ mode, scanRequired: mode !== 'off', legacyUploadClosed });

test('publish path matrix: server mode × whether this build can reach the scan service', () => {
  // build WITH the scan service configured: always the scan (photos get watermarked), whatever the server mode
  for (const policy of [P('off'), P('shadow'), P('enforce'), null]) assert.deepEqual(choosePublishPath(policy, true), { kind: 'scan' });
  // build WITHOUT it: legacy only while the server doesn't need the check...
  assert.deepEqual(choosePublishPath(P('off'), false), { kind: 'legacy' });
  assert.deepEqual(choosePublishPath(null, false), { kind: 'legacy' });
  // ...and a clear "update required" stop the moment it does — never a silent legacy upload
  for (const mode of ['shadow', 'enforce'] as const) assert.deepEqual(choosePublishPath(P(mode), false), { kind: 'blocked', reason: 'update_required' });
});

test('parsePolicy accepts only the three known modes and never trusts a missing scanRequired', () => {
  assert.deepEqual(parsePolicy({ mode: 'off', scanRequired: false, legacyUploadClosed: false }), P('off'));
  assert.deepEqual(parsePolicy({ mode: 'enforce', scanRequired: true, legacyUploadClosed: true }), P('enforce', true));
  assert.equal(parsePolicy({ mode: 'enforce' })?.scanRequired, true, 'enforce implies scan required even if the flag is missing');
  assert.equal(parsePolicy({ mode: 'shadow' })?.scanRequired, true);
  for (const bad of [null, undefined, 'enforce', 7, {}, { mode: 'turbo' }, { mode: null }]) assert.equal(parsePolicy(bad), null);
});

test('database refusals are recognised by hint or message and explained, other errors are not mistaken for them', () => {
  assert.equal(scanBlockFromDbError({ message: 'Photo has not been checked', hint: 'image_not_verified' }), 'not_verified');
  assert.equal(scanBlockFromDbError('Photo has not been checked'), 'not_verified');
  assert.equal(scanBlockFromDbError({ message: 'x', details: 'image_not_verified' }), 'not_verified');
  assert.equal(scanBlockFromDbError({ message: 'Photo was not accepted', hint: 'image_rejected' }), 'photo_rejected');
  for (const other of [null, undefined, 'network down', { message: 'duplicate key value' }, { message: 'This listing is under review and cannot be changed' }, new Error('boom')]) {
    assert.equal(scanBlockFromDbError(other), null);
  }
});

test('presign refusals map to the same vocabulary', () => {
  assert.equal(scanBlockFromPresignBody({ error: 'x', code: 'update_required' }), 'update_required');
  assert.equal(scanBlockFromPresignBody({ error: 'x', code: 'policy_unavailable' }), 'policy_unavailable');
  for (const other of [null, {}, { code: 'other' }, 'update_required']) assert.equal(scanBlockFromPresignBody(other), null);
});

test('"publish for review" is offered only when the listing will really be held (enforce) or nothing was kept private', () => {
  const held = { images: [{ held: false }, { held: true }] };
  const open = { images: [{ held: false }, { held: false }] };
  assert.equal(reviewPublishAllowed(held, P('enforce')), true);
  for (const policy of [P('off'), P('shadow'), null]) assert.equal(reviewPublishAllowed(held, policy), false, 'a privately-held photo would leave a live listing with a broken image');
  for (const policy of [P('off'), P('shadow'), P('enforce'), null]) assert.equal(reviewPublishAllowed(open, policy), true);
});
