// Policy tests for lib/imageSafety.ts. The "provider signals" below are HAND-WRITTEN fixtures shaped like
// Google Vision output — they test our decision policy, NOT the accuracy of any live model. Real-provider
// accuracy (false positives / negatives) must be measured separately on a labelled photo set; see
// docs/IMAGE_SAFETY.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideBatch, decideImage, readWatermarkText, dhash, hamming, scanFingerprint, watermarkLayout, grayFromRgba,
  type ImageEvidence, type ListingContext, type ProviderSignals,
} from '../lib/imageSafety';

const SAFE = { adult: 'VERY_UNLIKELY', violence: 'VERY_UNLIKELY', racy: 'VERY_UNLIKELY' } as const;
const sig = (labels: [string, number][], over: Partial<ProviderSignals> = {}): ProviderSignals => ({
  safeSearch: { ...SAFE }, labels: labels.map(([name, score]) => ({ name, score })), text: '', ...over,
});
const ev = (index: number, signals?: ProviderSignals, extra: Partial<ImageEvidence> = {}): ImageEvidence => ({ index, signals, ...extra });
const ctx = (categoryId: string, over: Partial<ListingContext> = {}): ListingContext => ({ categoryId, categoryLabel: categoryId, title: 'Item for sale', ...over });

test('clean, on-category photo passes', () => {
  const r = decideBatch([ev(0, sig([['Mobile phone', 0.97], ['Smartphone', 0.95]]))], ctx('phones'));
  assert.equal(r.outcome, 'approved');
  assert.deepEqual(r.issues, []);
  assert.equal(r.canRetry, false);
});

test('watermark: own brand and other marketplaces are rejected, ambiguous text is only reviewed', () => {
  assert.equal(readWatermarkText('Suuqiye Suuqiye').kind, 'own');
  assert.equal(readWatermarkText('SUUQ IYE').kind, 'own');
  assert.equal(readWatermarkText('jiji.so  jiji.so').kind, 'other');
  assert.equal(readWatermarkText('olx.com').kind, 'other'); // URL-shaped single mention
  assert.equal(readWatermarkText('Amazon').kind, 'uncertain'); // could just be packaging
  assert.equal(readWatermarkText('Samsung Galaxy S23 128GB').kind, 'none'); // legitimate text
  assert.equal(readWatermarkText('').kind, 'none');

  const own = decideImage(ev(0, sig([['Mobile phone', 0.9]], { text: 'Suuqiye' })), ctx('phones'));
  assert.equal(own.verdict, 'reject');
  assert.deepEqual(own.issues, ['watermark_own']);
  const amazon = decideImage(ev(0, sig([['Mobile phone', 0.9]], { text: 'Amazon' })), ctx('phones'));
  assert.equal(amazon.verdict, 'review');
  assert.deepEqual(amazon.issues, ['watermark_uncertain']);
});

test('text on products, signs and screens is not a watermark', () => {
  const r = decideImage(ev(0, sig([['Laptop', 0.95]], { text: 'DELL XPS 13 Intel Core i7 16GB Windows 11' })), ctx('electronics'));
  assert.equal(r.verdict, 'pass');
});

test('duplicates: other owner → review (never reject), same owner → pass, in-batch → fix', () => {
  const s = sig([['Sofa', 0.9]]);
  const other = decideImage(ev(0, s, { duplicates: [{ distance: 2, sameOwner: false }] }), ctx('furniture'));
  assert.equal(other.verdict, 'review');
  assert.deepEqual(other.issues, ['duplicate_listing']);
  const mine = decideImage(ev(0, s, { duplicates: [{ distance: 0, sameOwner: true }] }), ctx('furniture'));
  assert.equal(mine.verdict, 'pass');
  const far = decideImage(ev(0, s, { duplicates: [{ distance: 20, sameOwner: false }] }), ctx('furniture'));
  assert.equal(far.verdict, 'pass');
  const batch = decideImage(ev(1, s, { batchDuplicateOf: 0 }), ctx('furniture'));
  assert.equal(batch.verdict, 'reject');
  assert.deepEqual(batch.issues, ['duplicate_in_batch']);
});

test('content safety: very likely adult/violence rejected, likely only reviewed, racy swimwear tolerated', () => {
  const mk = (ss: Partial<NonNullable<ProviderSignals['safeSearch']>>) => decideImage(ev(0, sig([['Clothing', 0.9]], { safeSearch: { ...SAFE, ...ss } })), ctx('fashion'));
  assert.equal(mk({ adult: 'VERY_LIKELY' }).verdict, 'reject');
  assert.equal(mk({ violence: 'VERY_LIKELY' }).verdict, 'reject');
  assert.equal(mk({ adult: 'LIKELY' }).verdict, 'review');
  assert.equal(mk({ violence: 'LIKELY' }).verdict, 'review');
  assert.equal(mk({ racy: 'LIKELY' }).verdict, 'pass');
  assert.equal(mk({ racy: 'VERY_LIKELY' }).verdict, 'review');
  assert.equal(mk({ adult: 'POSSIBLE' }).verdict, 'pass');
});

test('weapons: confident firearm rejected; toy, sports and low confidence go to review/pass', () => {
  const gun = (score: number, extra: [string, number][] = []) => sig([['Firearm', score], ['Rifle', score - 0.02], ...extra]);
  assert.equal(decideImage(ev(0, gun(0.93)), ctx('electronics')).verdict, 'reject');
  assert.deepEqual(decideImage(ev(0, gun(0.93)), ctx('electronics')).issues.includes('weapon'), true);
  assert.equal(decideImage(ev(0, gun(0.7)), ctx('electronics')).verdict, 'review');
  assert.equal(decideImage(ev(0, gun(0.4)), ctx('electronics')).issues.includes('weapon'), false);
  assert.equal(decideImage(ev(0, gun(0.95, [['Toy', 0.9]])), ctx('baby')).verdict, 'review'); // toy gun
  assert.equal(decideImage(ev(0, gun(0.95)), ctx('sports')).verdict, 'review'); // ambiguous category
  // object localization counts too
  const obj = sig([['Tool', 0.6]], { objects: [{ name: 'Handgun', score: 0.9, area: 0.2 }] });
  assert.equal(decideImage(ev(0, obj), ctx('electronics')).verdict, 'reject');
});

test('category: phone listing with a shoe is a mismatch; land listing with a phone too', () => {
  const shoe = decideImage(ev(0, sig([['Footwear', 0.96], ['Shoe', 0.95]])), ctx('phones', { title: 'iPhone 13 128GB' }));
  assert.equal(shoe.verdict, 'reject');
  assert.deepEqual(shoe.issues, ['category_mismatch']);
  const phoneOnLand = decideImage(ev(0, sig([['Mobile phone', 0.95], ['Gadget', 0.9]])), ctx('property', { title: 'Plot for sale' }));
  assert.equal(phoneOnLand.verdict, 'reject');
});

test('category: valid exceptions and fallbacks', () => {
  // house photo under property
  assert.equal(decideImage(ev(0, sig([['House', 0.95], ['Building', 0.9]])), ctx('property')).verdict, 'pass');
  // a person wearing the clothing being sold is fine
  assert.equal(decideImage(ev(0, sig([['Person', 0.98], ['Dress', 0.9], ['Clothing', 0.92]])), ctx('fashion')).verdict, 'pass');
  // a plot of land is mostly sky and grass
  assert.equal(decideImage(ev(0, sig([['Sky', 0.95], ['Grass', 0.9]])), ctx('property', { title: 'Land plot Hargeisa' })).verdict, 'pass');
  // services / jobs / business accept anything
  for (const c of ['services', 'jobs', 'business']) assert.equal(decideImage(ev(0, sig([['Person', 0.99]])), ctx(c)).verdict, 'pass');
  // unknown (future) category id is lenient
  assert.equal(decideImage(ev(0, sig([['Cat', 0.9]])), ctx('brand-new-category')).verdict, 'pass');
  // nothing recognisable → uncertain, not rejected
  const unsure = decideImage(ev(0, sig([['Photograph', 0.6]])), ctx('phones', { title: 'iPhone' }));
  assert.equal(unsure.verdict, 'review');
  assert.deepEqual(unsure.issues, ['category_uncertain']);
});

test('category: title words are evidence, image-text probabilities can confirm or contradict', () => {
  const r = decideImage(ev(0, sig([['Terrier', 0.8]])), ctx('animals', { title: 'Terrier puppy vaccinated' }));
  assert.equal(r.verdict, 'pass');
  const clip = decideImage(ev(0, sig([['Photograph', 0.5]], { categoryProbs: { phones: 0.05, fashion: 0.85 } })), ctx('phones'));
  assert.equal(clip.verdict, 'reject');
  const clipOk = decideImage(ev(0, sig([['Photograph', 0.5]], { categoryProbs: { phones: 0.8, fashion: 0.1 } })), ctx('phones'));
  assert.equal(clipOk.verdict, 'pass');
});

test('provider failure is never silently safe', () => {
  const failed = decideImage({ index: 0, providerFailed: true }, ctx('phones'));
  assert.equal(failed.verdict, 'review');
  assert.deepEqual(failed.issues, ['check_failed']);
  const missing = decideImage({ index: 0 }, ctx('phones'));
  assert.equal(missing.verdict, 'review');
  const r = decideBatch([ev(0, sig([['Mobile phone', 0.9]])), { index: 1, providerFailed: true }], ctx('phones'));
  assert.equal(r.outcome, 'pending_review');
  assert.equal(r.canRetry, true);
});

test('batch: 1–8 images accepted, 0 and 9 refused', () => {
  const good = (i: number) => ev(i, sig([['Mobile phone', 0.95]]));
  for (let n = 1; n <= 8; n++) {
    const r = decideBatch(Array.from({ length: n }, (_, i) => good(i)), ctx('phones'));
    assert.equal(r.images.length, n);
    assert.equal(r.outcome, 'approved');
  }
  assert.throws(() => decideBatch([], ctx('phones')), RangeError);
  assert.throws(() => decideBatch(Array.from({ length: 9 }, (_, i) => good(i)), ctx('phones')), RangeError);
});

test('batch: all issues are reported once, grouped, with affected photo indexes; valid photos stay valid', () => {
  const phone = sig([['Mobile phone', 0.95]]);
  const r = decideBatch(
    [
      ev(0, phone),
      ev(1, sig([['Shoe', 0.95], ['Footwear', 0.95]])),
      ev(2, sig([['Shoe', 0.95], ['Footwear', 0.92]])),
      ev(3, sig([['Mobile phone', 0.9]], { text: 'Suuqiye' })),
      ev(4, phone, { duplicates: [{ distance: 1, sameOwner: false }] }),
    ],
    ctx('phones', { title: 'iPhone' }),
  );
  assert.equal(r.outcome, 'needs_changes');
  assert.equal(r.images[0].verdict, 'pass');
  const mismatch = r.issues.find((i) => i.code === 'category_mismatch')!;
  assert.deepEqual(mismatch.indexes, [1, 2]); // one message for both photos, not two modals
  assert.equal(r.issues.filter((i) => i.code === 'category_mismatch').length, 1);
  assert.deepEqual(r.issues.find((i) => i.code === 'watermark_own')!.indexes, [3]);
  assert.deepEqual(r.issues.find((i) => i.code === 'duplicate_listing')!.indexes, [4]);
  // fixes are listed before informational reviews
  const sevs = r.issues.map((i) => i.severity);
  assert.deepEqual(sevs, [...sevs].sort((a, b) => (a === b ? 0 : a === 'fix' ? -1 : 1)));
  assert.equal(r.issues.every((i) => i.messageKey.startsWith('imageScan.issue.')), true);
});

test('repeated duplicate hits flag staff but never reject on their own', () => {
  const s = sig([['Mobile phone', 0.95]]);
  const r = decideBatch([ev(0, s)], ctx('phones', { recentDuplicateHits: 3 }));
  assert.equal(r.outcome, 'approved');
  assert.equal(r.flagForStaff, true);
  assert.equal(decideBatch([ev(0, s)], ctx('phones')).flagForStaff, false);
});

test('internal details never appear in consolidated user-facing issues', () => {
  const r = decideBatch([ev(0, sig([['Firearm', 0.95]], { text: 'jiji.so jiji.so' }))], ctx('electronics'));
  const userFacing = JSON.stringify(r.issues);
  assert.equal(/0\.9|firearm|jiji|VERY_/i.test(userFacing), false);
});

test('dhash/hamming: identical, near and unrelated images', () => {
  const base = Array.from({ length: 72 }, (_, i) => (i * 37 + (i % 9) * 11) % 256);
  const h = dhash(base);
  assert.equal(h.length, 16);
  assert.equal(hamming(h, h), 0);
  // global brightness shift / mild noise keeps gradients → tiny distance
  const brighter = base.map((v) => Math.min(255, v + 10));
  assert.ok(hamming(h, dhash(brighter)) <= 4);
  const noisy = base.map((v, i) => (i % 17 === 0 ? v + 3 : v));
  assert.ok(hamming(h, dhash(noisy)) <= 6);
  const other = Array.from({ length: 72 }, (_, i) => (i * 91 + 13) % 256);
  assert.ok(hamming(h, dhash(other)) > 10);
  assert.throws(() => dhash([1, 2, 3]), RangeError);
  assert.equal(hamming('0000000000000000', 'ffffffffffffffff'), 64);
  assert.deepEqual(Array.from(grayFromRgba(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]), 2)), [255, 0]);
});

test('scan fingerprint: stable for reordered photos, changes with any relevant input', () => {
  const c = { categoryId: 'phones', title: 'iPhone 13', description: 'good' };
  const a = scanFingerprint(['h1', 'h2'], c);
  assert.equal(scanFingerprint(['h2', 'h1'], c), a);
  assert.equal(scanFingerprint(['h1', 'h2'], { ...c, title: ' IPHONE 13 ' }), a); // trivial edits reuse the cache
  assert.notEqual(scanFingerprint(['h1', 'h3'], c), a);
  assert.notEqual(scanFingerprint(['h1', 'h2'], { ...c, categoryId: 'electronics' }), a);
  assert.notEqual(scanFingerprint(['h1', 'h2'], { ...c, title: 'Samsung S23' }), a);
});

test('watermark layout covers the whole image, scales with size and is deterministic', () => {
  const small = watermarkLayout(400, 300);
  const big = watermarkLayout(1600, 1200);
  assert.deepEqual(watermarkLayout(400, 300), small);
  assert.ok(big.fontSize > small.fontSize);
  assert.equal(small.text, 'Suuqiye');
  assert.ok(small.opacity > 0.1 && small.opacity < 0.6);
  // every point of the image (in the rotated frame) is within one cell of a mark → mark repeats across the image
  const rad = (-small.angle * Math.PI) / 180;
  const stepX = Math.round(small.fontSize * 7.5);
  const stepY = Math.round(small.fontSize * 4.6);
  for (const [px, py] of [[-190, -140], [190, 140], [0, 0], [-190, 140], [190, -140]]) {
    const rx = px * Math.cos(rad) - py * Math.sin(rad);
    const ry = px * Math.sin(rad) + py * Math.cos(rad);
    const near = small.items.some((i) => Math.abs(i.x - rx) <= stepX && Math.abs(i.y - ry) <= stepY);
    assert.ok(near, `no mark near (${px},${py})`);
  }
});
