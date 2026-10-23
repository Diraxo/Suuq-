import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_WIDTH, imageResizeEnabled, imageUrl } from '../lib/imageUrl';
import { hashAt, imagePlaceholder, isThumbhash } from '../lib/imagePlaceholder';

const BASE = 'https://media.suuqiye.com';
const R2 = `${BASE}/listings/0b1c2d3e-0000-4000-8000-000000000001/1700000000000/3f2c7c1e-1111-4222-8333-444455556666.jpg`;
const CLOUDINARY = 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg';

test('R2 photos get a Cloudflare resize URL at the requested size', () => {
  const thumb = imageUrl(R2, { size: 'thumb' }, BASE);
  assert.equal(thumb, `${BASE}/cdn-cgi/image/width=400,quality=75,fit=scale-down,format=auto/listings/0b1c2d3e-0000-4000-8000-000000000001/1700000000000/3f2c7c1e-1111-4222-8333-444455556666.jpg`);
  assert.match(imageUrl(R2, { size: 'card' }, BASE), /width=800,/);
  assert.match(imageUrl(R2, { size: 'full' }, BASE), /width=1600,/);
  assert.match(imageUrl(R2, { size: 'tiny' }, BASE), /width=32,quality=40,/);
});

test('without a resize base, or for another host, the original URL is returned unchanged', () => {
  assert.equal(imageUrl(R2, { size: 'thumb' }, ''), R2);
  assert.equal(imageUrl('https://pub-abc.r2.dev/x.jpg', { size: 'thumb' }, BASE), 'https://pub-abc.r2.dev/x.jpg');
  assert.equal(imageUrl('https://picsum.photos/seed/a/200', { width: 200 }, BASE), 'https://picsum.photos/seed/a/200');
  assert.equal(imageUrl('', { size: 'thumb' }, BASE), '');
});

test('a host that merely starts with the base is not rewritten', () => {
  assert.equal(imageUrl('https://media.suuqiye.com.evil.example/x.jpg', { size: 'thumb' }, BASE), 'https://media.suuqiye.com.evil.example/x.jpg');
});

test('already-transformed, traversal, query and fragment URLs are left alone', () => {
  const done = `${BASE}/cdn-cgi/image/width=400/x.jpg`;
  assert.equal(imageUrl(done, { size: 'card' }, BASE), done);
  for (const bad of [`${BASE}/a/../b.jpg`, `${BASE}/a.jpg?x=1`, `${BASE}/a.jpg#t`]) assert.equal(imageUrl(bad, { size: 'card' }, BASE), bad);
});

test('legacy Cloudinary URLs keep their delivery transform, now at the same sizes', () => {
  assert.equal(imageUrl(CLOUDINARY, { size: 'thumb' }, BASE), 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_400/v1/sample.jpg');
  assert.match(imageUrl(CLOUDINARY, { width: 1200 }, ''), /w_1200/);
  assert.match(imageUrl(CLOUDINARY, undefined, ''), /w_1600/);
});

test('widths are clamped', () => {
  assert.match(imageUrl(R2, { width: 1 }, BASE), /width=16,/);
  assert.match(imageUrl(R2, { width: 99999 }, BASE), /width=2400,/);
});

test('the width table matches the sizes the screens rely on', () => {
  assert.deepEqual({ ...IMAGE_WIDTH }, { tiny: 32, thumb: 400, card: 800, full: 1600 });
});

test('resizing is enabled only for a clean https origin', () => {
  assert.equal(imageResizeEnabled(BASE), true);
  assert.equal(imageResizeEnabled(''), false);
});

test('thumbhash validation accepts base64 and rejects everything else', () => {
  assert.equal(isThumbhash('3PcNNYSFeXh/b4iAd3d4h4eAeAh4'), true);
  for (const bad of ['', 'short', 'has space in it!!', '<script>alert(1)</script>', 'a'.repeat(200), 12, null, undefined]) assert.equal(isThumbhash(bad), false);
});

test('hashAt only trusts hashes that line up with the images', () => {
  const hashes = ['3PcNNYSFeXh/b4iAd3d4h4eAeAh4', 'AAAAAAAAAAAAAAAAAAAAAAAA'];
  assert.equal(hashAt(hashes, 2, 1), hashes[1]);
  assert.equal(hashAt(hashes, 3, 1), undefined, 'length mismatch means the photos were edited elsewhere');
  assert.equal(hashAt(undefined, 2, 0), undefined);
  assert.equal(hashAt(['not valid!'], 1, 0), undefined);
});

test('placeholder prefers the stored hash, then a tiny copy where resizing is on, else nothing', () => {
  assert.deepEqual(imagePlaceholder('3PcNNYSFeXh/b4iAd3d4h4eAeAh4', R2), { thumbhash: '3PcNNYSFeXh/b4iAd3d4h4eAeAh4' });
  assert.equal(imagePlaceholder(undefined, R2), undefined, 'no resize base configured in the test environment');
  assert.equal(imagePlaceholder('bad hash', undefined), undefined);
});

test('migration 0073 adds image_hashes and a rollback exists', () => {
  const root = path.join(__dirname, '..', '..');
  const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '0073_listing_image_hashes.sql'), 'utf8');
  assert.match(sql, /add column if not exists image_hashes text\[\] not null default '\{\}'/);
  assert.match(sql, /before update of images/);
  assert.ok(fs.existsSync(path.join(root, 'supabase', 'rollback', '0073_listing_image_hashes_ROLLBACK.sql')));
});
