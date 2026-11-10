import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { auditActionLabel, cappedNotice, plural, resultLine, sentenceCase, targetLabel } from '../web/src/lib/adminText';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

test('raw database values become readable sentences', () => {
  assert.equal(sentenceCase('grant_boost'), 'Grant boost');
  assert.equal(sentenceCase('awaitingStaff'), 'Awaiting staff');
  assert.equal(sentenceCase(''), '');
  assert.equal(auditActionLabel('warn_user'), 'Warned user');
  assert.equal(auditActionLabel('some_new_action'), 'Some new action'); // never a raw snake_case key
  assert.equal(targetLabel('listing'), 'Listing');
});

test('counts and page lines read naturally', () => {
  assert.equal(plural(1, 'listing'), '1 listing');
  assert.equal(plural(1234, 'user'), '1,234 users');
  assert.equal(resultLine(120, 'listing', 1, 5), '120 listings · page 2 of 5');
  assert.equal(resultLine(7, 'case', 0, 1), '7 cases');
});

test('a list that stops at its query limit says so', () => {
  assert.equal(cappedNotice(99, 100, 'user'), null);
  assert.match(cappedNotice(100, 100, 'user')!, /100 newest users/);
});

test('every staff list uses the shared kit, so they look and behave the same', () => {
  for (const page of ['listings/page', 'users/page', 'support/page', 'history/page', 'page']) {
    assert.match(read(`web/src/app/admin/${page}.tsx`), /AdminPageHeader/, page);
  }
  for (const page of ['listings/page', 'users/page', 'support/page', 'history/page']) {
    assert.match(read(`web/src/app/admin/${page}.tsx`), /ListSkeleton/, `${page} shows a skeleton, not bare "Loading…"`);
    assert.ok(!/>Loading…</.test(read(`web/src/app/admin/${page}.tsx`)), `${page} has a bare Loading…`);
  }
  // filters wrap instead of scrolling sideways
  assert.ok(!/overflow-x-auto/.test(read('web/src/components/AdminUI.tsx')));
});
