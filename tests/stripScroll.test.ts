import test from 'node:test';
import assert from 'node:assert/strict';
import { stripScrollOffset } from '../lib/stripScroll';

const base = { viewport: 390, cell: 56, gap: 8, pad: 8 };
const at = (index: number, count: number, viewport = base.viewport) => stripScrollOffset({ ...base, viewport, index, count });

test('one to five photos fit the screen: never scrolls', () => {
  for (const n of [1, 2, 5]) for (let i = 0; i < n; i++) assert.equal(at(i, n), 0, `${n} photos, selected ${i}`);
});

test('eight photos: the first stays at the start, the last at the end, the middle is centred', () => {
  const content = 8 + 8 * 56 + 7 * 8 + 8; // 520
  assert.equal(at(0, 8), 0);
  assert.equal(at(7, 8), content - 390);
  const mid = at(4, 8);
  assert.ok(mid > 0 && mid < content - 390);
  // the selected thumbnail's centre is the viewport's centre
  assert.equal(8 + 4 * 64 + 28 - mid, 390 / 2);
});

test('many photos: monotonic, always within [0, content - viewport]', () => {
  const n = 30;
  const max = 8 * 2 + n * 56 + (n - 1) * 8 - 390;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    const o = at(i, n);
    assert.ok(o >= 0 && o <= max);
    assert.ok(o >= prev);
    prev = o;
  }
  assert.equal(at(n - 1, n), max);
});

test('bad input is harmless: out-of-range index clamps, empty list or unmeasured viewport gives 0', () => {
  assert.equal(at(99, 8), at(7, 8));
  assert.equal(at(-5, 8), 0);
  assert.equal(at(NaN, 8), 0);
  assert.equal(at(0, 0), 0);
  assert.equal(at(3, 8, 0), 0);
});

test('a narrow screen scrolls sooner', () => {
  assert.ok(at(3, 5, 240) > 0);
});
