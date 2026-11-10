import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DISCOUNT_DAYS,
  DISCOUNT_MAX_DAYS,
  activeDiscount,
  discountEndsAtFor,
  discountEndsIn,
  discountEndsText,
  discountFromRow,
  discountServerError,
  formatDiscountInstant,
  parseCustomDays,
  percentFromPrice,
  priceFromPercent,
  settledListingPrice,
  validateDiscountInput,
} from '../lib/discount';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-25T09:00:00Z');
const live = (over: Record<string, unknown> = {}) => ({ price: 9000, discountOriginalPrice: 10000, discountEndsAt: NOW + 5 * DAY, ...over });

test('a running seller discount is a discount with a rounded percent, the end date and the note', () => {
  assert.deepEqual(activeDiscount(live(), NOW), { originalPrice: 10000, percent: 10, endsAt: NOW + 5 * DAY });
  assert.equal(activeDiscount(live({ discountNote: '  Eid offer ' }), NOW)?.note, 'Eid offer');
  assert.equal(activeDiscount(live({ discountNote: '   ' }), NOW)?.note, undefined);
});

test('no discount without one set, after it ends, when not lower, or under 1%', () => {
  assert.equal(activeDiscount({ price: 9000 }, NOW), null);
  assert.equal(activeDiscount(live({ discountEndsAt: NOW }), NOW), null, 'ends exactly now = over');
  assert.equal(activeDiscount(live({ discountEndsAt: NOW - 1 }), NOW), null);
  assert.equal(activeDiscount(live({ price: 10000 }), NOW), null);
  assert.equal(activeDiscount(live({ price: 12000 }), NOW), null);
  assert.equal(activeDiscount(live({ price: 9990 }), NOW), null);
});

test('the 1% floor is exact', () => {
  assert.equal(activeDiscount(live({ price: 9900 }), NOW)?.percent, 1);
  assert.equal(activeDiscount(live({ price: 9901 }), NOW), null);
  assert.equal(activeDiscount(live({ price: 9950 }), NOW), null, '0.5% rounds to 1 but is not a whole 1% off');
});

test('a normal price edit (no discount fields) never produces a badge', () => {
  assert.equal(activeDiscount({ price: 800, status: 'available' }, NOW), null);
});

test('invalid or missing facts never produce a discount', () => {
  assert.equal(activeDiscount(live({ discountEndsAt: Number.NaN }), NOW), null);
  assert.equal(activeDiscount(live({ discountOriginalPrice: Number.NaN }), NOW), null);
  assert.equal(activeDiscount(live({ discountOriginalPrice: Infinity }), NOW), null);
  assert.equal(activeDiscount(live({ price: Number.NaN }), NOW), null);
  assert.equal(activeDiscount(live({ price: 0, discountOriginalPrice: 0 }), NOW), null);
  assert.equal(activeDiscount({ price: 9000, discountOriginalPrice: 10000 }, NOW), null);
  assert.equal(activeDiscount({ price: 9000, discountEndsAt: NOW + DAY }, NOW), null);
});

test('only an available listing has a discount (sold, reserved, expired, removed, deactivated do not)', () => {
  assert.equal(activeDiscount(live({ status: 'available' }), NOW)?.percent, 10);
  for (const status of ['sold', 'reserved', 'expired', 'removed', 'deactivated']) assert.equal(activeDiscount(live({ status }), NOW), null, status);
});

test('old price, new price, percent and savings agree', () => {
  for (const [price, was] of [[9000, 10000], [7500, 10000], [12345, 15000], [99, 100], [1, 3]] as const) {
    const d = activeDiscount(live({ price, discountOriginalPrice: was }), NOW);
    assert.ok(d, String(price));
    assert.equal(d.originalPrice, was);
    assert.equal(d.percent, Math.round(((was - price) / was) * 100));
  }
});

test('countdown: "ends today" in the last 24 hours, otherwise whole days rounded up, nothing once over', () => {
  assert.deepEqual(discountEndsIn(NOW + 1000, NOW), { kind: 'today' });
  assert.deepEqual(discountEndsIn(NOW + DAY, NOW), { kind: 'today' }, 'exactly 24h left is still today');
  assert.deepEqual(discountEndsIn(NOW + DAY + 1, NOW), { kind: 'days', days: 2 });
  assert.deepEqual(discountEndsIn(NOW + 4.2 * DAY, NOW), { kind: 'days', days: 5 });
  assert.deepEqual(discountEndsIn(NOW + 30 * DAY, NOW), { kind: 'days', days: 30 });
  assert.equal(discountEndsIn(NOW, NOW), null);
  assert.equal(discountEndsIn(NOW - 1, NOW), null);
  assert.equal(discountEndsIn(Number.NaN, NOW), null);
});

test('typing a percent or a price fills in the other consistently', () => {
  assert.equal(priceFromPercent(10000, 10), 9000);
  assert.equal(priceFromPercent(999, 10), 899);
  assert.equal(percentFromPrice(10000, 9000), 10);
  assert.equal(percentFromPrice(3, 2), 33.3);
  assert.equal(percentFromPrice(0, 5), 0);
  for (const p of [1, 5, 10, 25, 50, 90]) {
    const price = priceFromPercent(100000, p);
    assert.equal(validateDiscountInput({ original: 100000, price, days: 7 }), undefined, `${p}%`);
  }
});

test('seller pre-check mirrors the database limits: 1% to 90%, whole prices, the four durations, a 60-character note', () => {
  const ok = { original: 1000, price: 900, days: 7 };
  assert.equal(validateDiscountInput(ok), undefined);
  assert.equal(validateDiscountInput({ ...ok, price: 1000 }), 'mustBeLower');
  assert.equal(validateDiscountInput({ ...ok, price: 1100 }), 'mustBeLower');
  assert.equal(validateDiscountInput({ ...ok, price: 995 }), 'tooSmall');
  assert.equal(validateDiscountInput({ ...ok, price: 990 }), undefined, 'exactly 1%');
  assert.equal(validateDiscountInput({ ...ok, price: 100 }), undefined, 'exactly 90%');
  assert.equal(validateDiscountInput({ ...ok, price: 99 }), 'tooLarge');
  assert.equal(validateDiscountInput({ ...ok, price: 0 }), 'invalid');
  assert.equal(validateDiscountInput({ ...ok, price: 500.5 }), 'invalid');
  assert.equal(validateDiscountInput({ ...ok, price: Number.NaN }), 'invalid');
  assert.equal(validateDiscountInput({ ...ok, original: 0 }), 'invalid');
  for (const d of DISCOUNT_DAYS) assert.equal(validateDiscountInput({ ...ok, days: d }), undefined);
  for (const d of [1, 5, 31, 40, 77, 365, 'forever' as const]) assert.equal(validateDiscountInput({ ...ok, days: d }), undefined, String(d));
  for (const d of [0, -1, 366, 1.5, 100000, Number.NaN, Infinity]) assert.equal(validateDiscountInput({ ...ok, days: d }), 'duration', String(d));
  assert.equal(validateDiscountInput({ ...ok, note: 'x'.repeat(60) }), undefined);
  assert.equal(validateDiscountInput({ ...ok, note: 'x'.repeat(61) }), 'noteTooLong');
  assert.equal(validateDiscountInput({ ...ok, note: 'a\u0007b' }), 'noteControl');
  assert.equal(validateDiscountInput({ ...ok, note: '   ' }), undefined);
});

test('the presets stay 3, 7, 14 and 30 days; a custom length goes up to 365 (the database limit)', () => {
  assert.deepEqual([...DISCOUNT_DAYS], [3, 7, 14, 30]);
  assert.equal(DISCOUNT_MAX_DAYS, 365);
});

test('custom days: digits only, whole, 1..365 - 0, negative, decimal, text and huge values are refused', () => {
  assert.equal(parseCustomDays('40'), 40);
  assert.equal(parseCustomDays(' 77 '), 77);
  assert.equal(parseCustomDays('1'), 1);
  assert.equal(parseCustomDays('365'), 365);
  for (const bad of ['', ' ', '0', '00', '-5', '7.5', '7,5', '366', '1000', '99999999999999999999', 'abc', '1e2', '+7']) assert.equal(parseCustomDays(bad), undefined, JSON.stringify(bad));
});

test('the exact end shown before confirming is now + days x 24 hours', () => {
  assert.equal(discountEndsAtFor(77, NOW), NOW + 77 * DAY);
  assert.equal(discountEndsAtFor(1, NOW), NOW + DAY);
});

test('a permanent discount: live with no end date, never "expires", same percent rules, and not shown for other statuses', () => {
  const forever = (over: Record<string, unknown> = {}) => ({ price: 54000, discountOriginalPrice: 60000, discountPermanent: true, ...over });
  assert.deepEqual(activeDiscount(forever(), NOW), { originalPrice: 60000, percent: 10, permanent: true });
  assert.deepEqual(activeDiscount(forever(), NOW + 900 * DAY), { originalPrice: 60000, percent: 10, permanent: true }, 'still live 900 days later');
  assert.equal(activeDiscount(forever({ discountEndsAt: NOW - 1 }), NOW)?.permanent, true, 'a stale ends value does not end a permanent one');
  assert.equal(activeDiscount(forever({ price: 60000 }), NOW), null);
  assert.equal(activeDiscount(forever({ price: 59999 }), NOW), null, 'under 1%');
  assert.equal(activeDiscount(forever({ discountOriginalPrice: undefined }), NOW), null);
  assert.equal(activeDiscount(forever({ status: 'sold' }), NOW), null);
  assert.equal(activeDiscount({ price: 54000, discountOriginalPrice: 60000 }, NOW), null, 'no end and not permanent is not a discount');
  assert.equal(activeDiscount(forever({ discountNote: ' Limited ' }), NOW)?.note, 'Limited');
});

test('a permanent row keeps its discount; the flag needs a missing end; a finite row is unchanged', () => {
  const base = { price: '54000', discount_original_price: '60000', discount_started_at: new Date(NOW - DAY).toISOString(), discount_note: null };
  const p = discountFromRow({ ...base, discount_ends_at: null, discount_permanent: true }, NOW + 500 * DAY);
  assert.equal(p.price, 54000);
  assert.equal(p.discountOriginalPrice, 60000);
  assert.equal(p.discountPermanent, true);
  assert.equal(p.discountEndsAt, undefined);
  assert.equal('discountEndsAt' in p, false, 'no fabricated end date');
  assert.deepEqual(discountFromRow({ ...base, discount_ends_at: null, discount_permanent: false }, NOW), { price: 54000 }, 'neither an end nor the flag: not a discount');
  assert.deepEqual(discountFromRow({ ...base, discount_ends_at: new Date(NOW + DAY).toISOString(), discount_permanent: true }, NOW).discountPermanent, undefined, 'the flag is only trusted with no end date');
  assert.equal(discountFromRow({ ...base, discount_ends_at: new Date(NOW + 77 * DAY).toISOString() }, NOW).discountEndsAt, NOW + 77 * DAY);
});

test('one ends-line for every screen: permanent, today, days', () => {
  const t = (key: string, o?: Record<string, string | number>) => (o ? key + JSON.stringify(o) : key);
  assert.equal(discountEndsText({ permanent: true }, t, NOW), 'discount.noEndDate');
  assert.equal(discountEndsText({ endsAt: NOW + 1000 }, t, NOW), 'discount.endsToday');
  assert.equal(discountEndsText({ endsAt: NOW + 3 * DAY }, t, NOW), 'discount.endsInDays{"count":3}');
  assert.equal(discountEndsText({ endsAt: NOW - 1 }, t, NOW), undefined);
  assert.equal(discountEndsText({}, t, NOW), undefined);
  assert.ok(formatDiscountInstant(NOW, 'en').includes('2026'));
  assert.equal(formatDiscountInstant(Number.NaN), '');
});

test('an ended, not yet settled discount shows the original price and no discount (never a silently low price)', () => {
  assert.equal(settledListingPrice(800, 1000, NOW - 1, NOW), 1000);
  assert.equal(settledListingPrice(800, 1000, NOW + 1, NOW), 800, 'still running');
  assert.equal(settledListingPrice(800, undefined, undefined, NOW), 800);
  const row = { price: '800', discount_original_price: '1000', discount_started_at: new Date(NOW - 3 * DAY).toISOString(), discount_ends_at: new Date(NOW - 1000).toISOString(), discount_note: 'Eid' };
  assert.deepEqual(discountFromRow(row, NOW), { price: 1000 });
  const running = discountFromRow({ ...row, discount_ends_at: new Date(NOW + DAY).toISOString() }, NOW);
  assert.equal(running.price, 800);
  assert.equal(running.discountOriginalPrice, 1000);
  assert.equal(running.discountEndsAt, NOW + DAY);
  assert.equal(running.discountNote, 'Eid');
  assert.deepEqual(discountFromRow({ price: 500 }, NOW), { price: 500 });
  assert.deepEqual(discountFromRow({ price: 500, discount_original_price: null, discount_ends_at: null }, NOW), { price: 500 });
});

test('database explanations map to translated error keys', () => {
  assert.deepEqual(discountServerError('A discount is already running on this listing'), { key: 'alreadyRunning' });
  assert.deepEqual(discountServerError('The price was changed recently. You can set a discount from 2026-11-03'), { key: 'recentlyChanged', params: { date: '2026-11-03' } });
  // 0081: the exact UTC instant, shown in the seller's own time zone (not a bare UTC date).
  const stamped = discountServerError('The price was changed recently. You can set a discount from 2026-10-28T23:30:00Z', 'en');
  assert.equal(stamped.key, 'recentlyChanged');
  assert.equal(stamped.params?.date, formatDiscountInstant(Date.parse('2026-10-28T23:30:00Z'), 'en'));
  assert.notEqual(stamped.params?.date, '2026-10-28');
  assert.deepEqual(discountServerError('A discount runs for 1 to 365 days, or until you end it'), { key: 'duration', params: { max: 365 } });
  assert.deepEqual(discountServerError('A discount runs for 1 to 30 days'), { key: 'duration', params: { max: 365 } }, 'the 0080 wording still maps');
  assert.deepEqual(discountServerError('The new price must be lower than the current price'), { key: 'mustBeLower' });
  assert.deepEqual(discountServerError('A discount must be at least 1%'), { key: 'tooSmall' });
  assert.deepEqual(discountServerError('A discount can be at most 90%'), { key: 'tooLarge' });
  assert.deepEqual(discountServerError('Only an available listing can be discounted'), { key: 'notAvailable' });
  assert.deepEqual(discountServerError('The note must be at most 60 characters, without special characters'), { key: 'noteTooLong', params: { max: 60 } });
  assert.deepEqual(discountServerError('something unexpected'), { key: 'generic' });
  assert.deepEqual(discountServerError(undefined), { key: 'generic' });
});

test('every discount error key the code can produce exists in all three languages', () => {
  const keys = ['invalid', 'mustBeLower', 'tooSmall', 'tooLarge', 'noteTooLong', 'noteControl', 'duration', 'alreadyRunning', 'recentlyChanged', 'notAvailable', 'generic', 'endFailed'];
  const root = path.join(__dirname, '..', '..');
  for (const lang of ['en', 'so', 'am']) {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'locales', lang, 'translation.json'), 'utf8'));
    for (const k of keys) assert.ok(j.discount.errors[k], `${lang}: discount.errors.${k}`);
    for (const k of ['title', 'start', 'end', 'endsToday', 'endsInDays_one', 'endsInDays_other', 'runningTitle', 'runningSummary', 'preview', 'days', 'action', 'manage', 'forever', 'customDaysLabel', 'customDaysPlaceholder', 'willEnd', 'endsOn', 'foreverNote', 'noEndDate', 'appliedUntil', 'appliedForever']) assert.ok(j.discount[k], `${lang}: discount.${k}`);
    if (lang === 'so') assert.equal(j.discount.action, 'Qiimo Dhimis', 'the agreed Somali term');
    assert.ok(j.listing.edit.priceLockedByDiscount, `${lang}: listing.edit.priceLockedByDiscount`);
    assert.equal(j.components.priceDropConfirm, undefined, `${lang}: the old "Change price?" window strings are gone`);
  }
});

test('the web copy is identical to the mobile copy', () => {
  const root = path.join(__dirname, '..', '..');
  const strip = (s: string) => s.replace(/^\/\/ Mirrored.*\n/m, '');
  assert.equal(strip(fs.readFileSync(path.join(root, 'lib/discount.ts'), 'utf8')), strip(fs.readFileSync(path.join(root, 'web/src/lib/discount.ts'), 'utf8')));
});
