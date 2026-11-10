import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_PHOTOS,
  addPhotos,
  removePhotoById,
  movePhoto,
  replacePhotoById,
  coverOf,
  isCover,
  remainingSlots,
  showAddTile,
  dragTargetIndex,
} from '../data/photoList';
import { MAX_LISTING_PHOTOS } from '../data/sellRules';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const mk = (...ids: string[]) => ids.map((id) => ({ id, uri: `file:///${id}.jpg` }));
const ids = (l: { id: string }[]) => l.map((p) => p.id);
// What the grid renders: real photos in order, then Add last while there is room — and nothing else.
const grid = (l: { id: string }[]) => [...ids(l), ...(showAddTile(l.length) ? ['+add'] : [])];
// What gets saved: upload order is list order, cover = first.
const toSave = (l: { id: string; uri: string }[]) => ({ images: l.map((p) => p.uri), cover: coverOf(l)?.uri });

test('limit matches the shared Sell rules', () => {
  assert.equal(MAX_PHOTOS, MAX_LISTING_PHOTOS);
  assert.equal(MAX_PHOTOS, 5);
});

test('1. camera: Use Photo appends the captured image to the form list (and it becomes the cover when first)', () => {
  const r = addPhotos([], mk('cam1'));
  assert.deepEqual(ids(r.list), ['cam1']);
  assert.equal(coverOf(r.list)?.id, 'cam1');
  assert.deepEqual(grid(r.list), ['cam1', '+add']);
});

test('2. camera with existing images keeps them, appends after, and leaves the cover alone', () => {
  const r = addPhotos(mk('a', 'b'), mk('cam'));
  assert.deepEqual(ids(r.list), ['a', 'b', 'cam']);
  assert.equal(coverOf(r.list)?.id, 'a');
});

test('3. cancelled camera adds nothing (no assets → same list)', () => {
  const before = mk('a', 'b');
  const r = addPhotos(before, []);
  assert.deepEqual(r.list, before);
  assert.notEqual(r.list, before, 'a new array, never the input');
  assert.equal(r.added.length, 0);
});

test('4. the sixth photo is rejected, from the camera or the gallery', () => {
  const full = mk('a', 'b', 'c', 'd', 'e');
  const cam = addPhotos(full, mk('cam'));
  assert.equal(cam.list.length, 5);
  assert.deepEqual(ids(cam.rejected), ['cam']);
  const gallery = addPhotos(mk('a', 'b', 'c'), mk('g1', 'g2', 'g3'));
  assert.deepEqual(ids(gallery.list), ['a', 'b', 'c', 'g1', 'g2']);
  assert.deepEqual(ids(gallery.rejected), ['g3']);
  assert.equal(showAddTile(gallery.list.length), false);
  assert.equal(remainingSlots(gallery.list.length), 0);
});

test('4b. photos waiting on a retry count against the cap', () => {
  const r = addPhotos(mk('a', 'b', 'c'), mk('x', 'y'), MAX_PHOTOS - 1);
  assert.deepEqual(ids(r.list), ['a', 'b', 'c', 'x']);
});

test('4c. a photo already in the list is not added twice', () => {
  const r = addPhotos(mk('a', 'b'), mk('b', 'c'));
  assert.deepEqual(ids(r.list), ['a', 'b', 'c']);
  assert.deepEqual(ids(r.duplicates), ['b']);
});

test('5. two images sit next to each other, Add tile right after', () => {
  assert.deepEqual(grid(mk('a', 'b')), ['a', 'b', '+add']);
});

test('layouts for 1..5 photos: consecutive, Add last, none at five', () => {
  assert.deepEqual(grid(mk('1')), ['1', '+add']);
  assert.deepEqual(grid(mk('1', '2', '3')), ['1', '2', '3', '+add']);
  assert.deepEqual(grid(mk('1', '2', '3', '4')), ['1', '2', '3', '4', '+add']);
  assert.deepEqual(grid(mk('1', '2', '3', '4', '5')), ['1', '2', '3', '4', '5']);
});

test('6. removing the second of five compacts the rest in order', () => {
  const next = removePhotoById(mk('a', 'b', 'c', 'd', 'e'), 'b');
  assert.deepEqual(ids(next), ['a', 'c', 'd', 'e']);
  assert.deepEqual(grid(next), ['a', 'c', 'd', 'e', '+add']);
});

test('7. removing the first of five makes the old second photo the cover', () => {
  const next = removePhotoById(mk('a', 'b', 'c', 'd', 'e'), 'a');
  assert.deepEqual(ids(next), ['b', 'c', 'd', 'e']);
  assert.equal(coverOf(next)?.id, 'b');
  assert.deepEqual(next.map((_, i) => isCover(i)), [true, false, false, false]);
});

test('8. removing the last photo puts Add at the end', () => {
  const next = removePhotoById(mk('a', 'b', 'c', 'd', 'e'), 'e');
  assert.deepEqual(grid(next), ['a', 'b', 'c', 'd', '+add']);
});

test('9. several consecutive removals never leave gaps or stale covers', () => {
  let l = mk('a', 'b', 'c', 'd', 'e');
  l = removePhotoById(l, 'c');
  l = removePhotoById(l, 'a');
  assert.deepEqual(ids(l), ['b', 'd', 'e']);
  assert.equal(coverOf(l)?.id, 'b');
  l = removePhotoById(l, 'e');
  l = removePhotoById(l, 'b');
  assert.deepEqual(ids(l), ['d']);
  assert.equal(coverOf(l)?.id, 'd');
  l = removePhotoById(l, 'd');
  assert.deepEqual(grid(l), ['+add']);
  assert.equal(coverOf(l), undefined);
});

test('removal never mutates its input and ignores unknown ids', () => {
  const before = mk('a', 'b');
  const snapshot = JSON.stringify(before);
  removePhotoById(before, 'a');
  movePhoto(before, 0, 1);
  assert.equal(JSON.stringify(before), snapshot);
  assert.deepEqual(ids(removePhotoById(before, 'zzz')), ['a', 'b']);
});

test('10. moving the first photo to position three moves the Cover badge to the real first photo', () => {
  const next = movePhoto(mk('a', 'b', 'c', 'd', 'e'), 0, 2);
  assert.deepEqual(ids(next), ['b', 'c', 'a', 'd', 'e']);
  assert.equal(coverOf(next)?.id, 'b');
  assert.deepEqual(next.map((_, i) => isCover(i)), [true, false, false, false, false]);
});

test('11. moving the third photo to position one makes it the cover', () => {
  const next = movePhoto(mk('a', 'b', 'c', 'd', 'e'), 2, 0);
  assert.deepEqual(ids(next), ['c', 'a', 'b', 'd', 'e']);
  assert.equal(coverOf(next)?.id, 'c');
});

test('12. moving between middle positions keeps every other photo in order', () => {
  assert.deepEqual(ids(movePhoto(mk('a', 'b', 'c', 'd', 'e'), 1, 3)), ['a', 'c', 'd', 'b', 'e']);
  assert.deepEqual(ids(movePhoto(mk('a', 'b', 'c', 'd', 'e'), 3, 1)), ['a', 'd', 'b', 'c', 'e']);
  assert.deepEqual(ids(movePhoto(mk('a', 'b', 'c', 'd', 'e'), 1, 2)), ['a', 'c', 'b', 'd', 'e']);
});

test('moves to the last position, and out-of-range targets clamp instead of corrupting the list', () => {
  assert.deepEqual(ids(movePhoto(mk('a', 'b', 'c'), 0, 2)), ['b', 'c', 'a']);
  assert.deepEqual(ids(movePhoto(mk('a', 'b', 'c'), 0, 99)), ['b', 'c', 'a']);
  assert.deepEqual(ids(movePhoto(mk('a', 'b', 'c'), 2, -5)), ['c', 'a', 'b']);
  assert.deepEqual(ids(movePhoto(mk('a', 'b', 'c'), 7, 0)), ['a', 'b', 'c']);
  assert.deepEqual(ids(movePhoto(mk('a', 'b', 'c'), 1, 1)), ['a', 'b', 'c']);
});

test('a reorder never loses, duplicates or blanks a photo', () => {
  const start = mk('a', 'b', 'c', 'd', 'e');
  for (let from = 0; from < 5; from++) {
    for (let to = 0; to < 5; to++) {
      const next = movePhoto(start, from, to);
      assert.deepEqual([...ids(next)].sort(), ['a', 'b', 'c', 'd', 'e']);
      assert.equal(next[to].id, start[from].id, `photo ${from} lands at ${to}`);
    }
  }
});

test('13. reorder five photos and save: the saved order and cover match the grid', () => {
  let l = mk('a', 'b', 'c', 'd', 'e');
  l = movePhoto(l, 4, 0); // e a b c d
  l = movePhoto(l, 2, 3); // e a c b d
  const saved = toSave(l);
  assert.deepEqual(saved.images, ids(l).map((id) => `file:///${id}.jpg`));
  assert.equal(saved.cover, saved.images[0]);
  assert.equal(saved.cover, 'file:///e.jpg');
});

test('14. editing a listing: existing photos stay intact until the seller changes them', () => {
  const existing = mk('u1', 'u2', 'u3');
  const afterAdd = addPhotos(existing, mk('new1')).list;
  assert.deepEqual(ids(afterAdd), ['u1', 'u2', 'u3', 'new1']);
  assert.deepEqual(ids(replacePhotoById(afterAdd, 'u2', { id: 'u2b', uri: 'file:///u2b.jpg' })), ['u1', 'u2b', 'u3', 'new1']);
  assert.deepEqual(ids(removePhotoById(afterAdd, 'new1')), ['u1', 'u2', 'u3']);
});

test('15. a photo that fails to save locally is kept as a Retry cell with an error, never silently dropped; edit screens never clear images on failure', () => {
  const src = read('app/post/index.tsx');
  const catchAt = src.indexOf('commit(removePhotoById(currentItems(), id));');
  const tail = src.slice(catchAt, catchAt + 400);
  assert.match(tail, /setFailedItems\(\(prev\) => \[\.\.\.prev, \{ key/);
  assert.match(tail, /couldNotAddPhoto/);
  // Upload/save failures in the edit screens only report an error; they have no path that calls setImages / setPhotos with an empty list.
  assert.ok(!/setImages\(\[\]\)/.test(read('app/listing/edit/[id].tsx')));
  assert.ok(!/setPhotos\(\[\]\)/.test(read('web/src/app/listing/edit/[id]/page.tsx')));
});

test('a persisted-copy swap keeps the photo in place and keeps its id (no remount, no reorder)', () => {
  const swapped = replacePhotoById(mk('a', 'b', 'c'), 'b', { id: 'b', uri: 'file:///permanent/b.jpg' });
  assert.deepEqual(ids(swapped), ['a', 'b', 'c']);
  assert.equal(swapped[1].uri, 'file:///permanent/b.jpg');
  assert.deepEqual(ids(replacePhotoById(mk('a', 'b'), 'gone', { id: 'gone', uri: 'x' })), ['a', 'b']);
});

test('drag targets are grid cells: the photo list index IS the cell index (Add tile is last)', () => {
  // 3 columns, 5 photos: cells 0..4 (row 0: 0,1,2  row 1: 3,4).
  assert.equal(dragTargetIndex(0, 1, 0, 3, 5), 1);
  assert.equal(dragTargetIndex(0, 2, 1, 3, 5), 4); // right two, down one
  assert.equal(dragTargetIndex(4, -2, -1, 3, 5), 0);
  assert.equal(dragTargetIndex(1, 0, 1, 3, 5), 4);
  assert.equal(dragTargetIndex(2, 0, 1, 3, 5), 4, 'past the last photo clamps onto it (never onto the Add tile)');
  assert.equal(dragTargetIndex(0, -3, 0, 3, 5), 0, 'before the first clamps to the cover slot');
  assert.equal(dragTargetIndex(0, 0, 0, 3, 0), 0);
});

// ── 16. mobile and web wire to the same behaviour ────────────────────────
test('16. web and mobile use byte-identical copies of the shared photo list', () => {
  assert.equal(read('data/photoList.ts'), read('web/src/lib/photoList.ts'));
});

test('16. every photo editor (mobile Sell + edit, web Sell + edit) uses the shared list and keys by id', () => {
  const mobileSell = read('app/post/index.tsx');
  const mobileEdit = read('app/listing/edit/[id].tsx');
  const webSell = read('web/src/app/sell/page.tsx');
  const webEdit = read('web/src/app/listing/edit/[id]/page.tsx');
  for (const [name, src] of [['mobile sell', mobileSell], ['mobile edit', mobileEdit], ['web sell', webSell], ['web edit', webEdit]] as const) {
    assert.match(src, /photoList'/, `${name} imports the shared photo list`);
  }
  assert.match(mobileSell, /key=\{photo\.id\}/);
  assert.match(mobileEdit, /key=\{item\}/);
  assert.match(webSell, /key=\{p\.id\}/);
  assert.match(webEdit, /key=\{slot\.id\}/);
  assert.ok(!/key=\{[^}]*\+ ?(index|i)\}/.test(mobileEdit + webEdit), 'no index-based keys');
});

test('mobile Sell: Add tile is last, no empty placeholders, cover badge only from index 0', () => {
  const src = read('app/post/index.tsx');
  assert.ok(!/kind: 'empty'/.test(src), 'empty placeholder cells are gone');
  assert.ok(!/emptySlotCount/.test(src));
  const cellsAt = src.indexOf('const cells: Cell[] = [');
  const block = src.slice(cellsAt, src.indexOf('];', cellsAt));
  assert.ok(block.indexOf("kind: 'photo'") < block.indexOf("kind: 'failed'") && block.indexOf("kind: 'failed'") < block.indexOf("kind: 'add'"), 'photos, retries, then Add');
  assert.match(src, /isCover\(photoIndex\)/);
  assert.ok(!/photoIndex === 0/.test(src));
});

test('mobile Sell: photos and photoIds are only written together, never as two separate setField calls', () => {
  const src = read('app/post/index.tsx');
  assert.ok(!/setField\('photos'/.test(src));
  assert.ok(!/setField\('photoIds'/.test(src));
  assert.match(read('store/postDraft.ts'), /setPhotoItems: \(items\) => set\(\{ photos: items\.map/);
});

test('mobile Sell camera: failures and cancellations are handled, never silent', () => {
  const src = read('app/post/index.tsx');
  const take = src.slice(src.indexOf('const takePhoto'), src.indexOf('const openAddPhotosMenu'));
  assert.match(take, /result\.canceled/);
  assert.match(take, /await addAssets\(result\.assets\)/);
  assert.match(take, /catch/);
  assert.match(take, /couldNotAddPhoto/);
});

test('mobile Sell drag: drop animates onto the target cell, then reorders; screen readers get move actions', () => {
  const src = read('app/post/index.tsx');
  assert.match(src, /dragTargetIndex\(/);
  assert.match(src, /runOnJS\(onReorder\)\(photoIndex, target\)/);
  assert.match(src, /accessibilityActions/);
  assert.match(src, /useLayoutEffect/);
});

test('web Sell and Edit can move a photo earlier AND later', () => {
  const sell = read('web/src/app/sell/page.tsx');
  const edit = read('web/src/app/listing/edit/[id]/page.tsx');
  assert.match(sell, /movePhotoBy\(i, 1\)/);
  assert.match(sell, /movePhotoBy\(i, -1\)/);
  assert.match(edit, /movePhoto\(i, 1\)/);
  assert.match(edit, /movePhoto\(i, -1\)/);
});

test('save order: both edit screens upload and save in list order and derive cover from the first image', () => {
  const mobile = read('app/listing/edit/[id].tsx');
  const web = read('web/src/app/listing/edit/[id]/page.tsx');
  assert.match(mobile, /const finalImages = images\.map\(/);
  assert.match(web, /photos\.map\(async \(slot\)/);
  assert.match(web, /const finalImages = finalPhotos\.map/);
});
