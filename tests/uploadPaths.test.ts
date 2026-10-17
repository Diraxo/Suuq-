import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedFolder, isOwnedKey } from '../supabase/functions/_shared/uploadPaths';

const A = '11111111-1111-4111-8111-111111111111';
const U = '33333333-3333-4333-8333-333333333333';

test('legitimate "<uuid>.jpg" keys still pass in every layout', () => {
  for (const key of [
    `listings/${A}/${U}.jpg`,
    `listings/${A}/draft-1_x/${U}.jpg`,
    `avatars/${A}/${U}.jpg`,
    `business/${A}/logo/${U}.jpg`,
    `business/${A}/banner/${U}.jpg`,
  ]) {
    assert.equal(isOwnedKey(key, A), true, key);
  }
});

test('chat is text-only: no new chat/ upload folder can be issued', () => {
  for (const folder of [`chat/${A}/${A}`, `chat/conv_123/${A}`, `chat/${A}`]) assert.equal(isAllowedFolder(folder, A), false, folder);
});

test('legacy chat keys stay deletable by their OWN user only (cleanup of pre-text-only objects)', () => {
  assert.equal(isOwnedKey(`chat/${A}/${A}/${U}.jpg`, A), true);
  assert.equal(isOwnedKey(`chat/conv-1/${A}/${U}.jpg`, A), true);
  assert.equal(isOwnedKey(`chat/conv-1/${A}/${U}.jpg`, U), false);
});

test('the dot before "jpg" is literal (regression: {uuid}Xjpg and {uuid}/jpg were accepted)', () => {
  for (const name of [`${U}Xjpg`, `${U}/jpg`, `${U}-jpg`, `${U} jpg`, `${U}_jpg`, `${U}.JPG.x`, `${U}.jpgx`]) {
    for (const key of [`listings/${A}/${name}`, `avatars/${A}/${name}`, `business/${A}/logo/${name}`, `chat/${A}/${A}/${name}`]) {
      assert.equal(isOwnedKey(key, A), false, key);
    }
  }
});

test('watermarked derivatives (wm/listings/...) are deletable by their owner only, and can never be an upload target', () => {
  const L = '33333333-3333-4333-8333-333333333333';
  const key = `wm/listings/${A}/${L}/${U}.jpg`;
  assert.equal(isOwnedKey(key, A), true);
  assert.equal(isOwnedKey(key, 'not-a-uuid'), false);
  assert.equal(isOwnedKey(key, '22222222-2222-4222-8222-222222222222'), false, "another user cannot delete someone else's derivative");
  for (const bad of [`wm/listings/${A}/${U}.jpg`, `wm/listings/${A}/x/${U}.jpg`, `wm/listings/${A}/${L}/../${U}.jpg`, `wm/listings/${A}/${L}/${U}.png`, `pending/wm/listings/${A}/${L}/${U}.jpg`, `orig/${A}/${L}/abc.bin`]) {
    assert.equal(isOwnedKey(bad, A), false, bad);
  }
  assert.equal(isAllowedFolder(`wm/listings/${A}/${L}`, A), false);
});
