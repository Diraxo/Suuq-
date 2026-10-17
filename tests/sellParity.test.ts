import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { categories } from '../data/categories';
import { categories as webCategories } from '../web/src/lib/categories';
import { usePublishSession, publishOnce, startPostFlow, isActivePostFlow } from '../store/publishSession';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

// The web build can't import from outside web/, so the shared Sell rules live
// in two byte-identical copies. If one is edited without the other, mobile and
// web would silently start accepting different data.
test('web copies of the shared Sell rules are identical to the mobile/server originals', () => {
  const pairs: [string, string][] = [
    ['data/sellRules.ts', 'web/src/lib/sellRules.ts'],
    ['data/categoryFields.ts', 'web/src/lib/categoryFields.ts'],
    ['data/fieldOptions.ts', 'web/src/lib/fieldOptions.ts'],
    ['data/categoryFeatures.ts', 'web/src/lib/categoryFeatures.ts'],
    ['supabase/functions/_shared/imageBytes.ts', 'web/src/lib/imageBytes.ts'],
  ];
  for (const [a, b] of pairs) assert.equal(read(a), read(b), `${a} and ${b} have drifted — copy the original over the web copy`);
});

test('mobile and web offer the same categories and subcategories', () => {
  assert.deepEqual(
    categories.map((c) => [c.id, (c.subcategories ?? []).map((s) => s.name)]),
    webCategories.map((c) => [c.id, (c.subcategories ?? []).map((s) => s.name)])
  );
});

test('the numeric keypad on mobile is driven by the shared rules, not a separate key list', () => {
  assert.ok(!/NUMERIC_FIELD_KEYS/.test(read('data/categoryFields.ts')), 'old key-only list removed');
  assert.ok(/keyboardFor\(field\)/.test(read('components/DynamicField.tsx')));
  assert.ok(/numericRuleFor/.test(read('web/src/components/SellField.tsx')));
});

test('web and mobile publish paths both run the shared publish-time gate', () => {
  assert.ok(/validateListingDraft\(/.test(read('web/src/app/sell/page.tsx')));
  assert.ok(/validateListingDraft\(/.test(read('app/post/preview.tsx')));
  // and neither silently strips non-digits out of a price any more
  for (const f of ['web/src/app/sell/page.tsx', 'app/post/price.tsx', 'app/listing/edit/[id].tsx', 'web/src/app/listing/edit/[id]/page.tsx']) {
    assert.ok(!/replace\(\/\[\^0-9\]\/g/.test(read(f)), `${f} still strips non-digits from the price`);
  }
});

test('every web image upload goes through the byte-level intake', () => {
  const r2 = read('web/src/services/r2.ts');
  assert.ok(/prepareImage\(/.test(r2));
  assert.ok(/'Content-Type': 'image\/jpeg'/.test(r2), 'always uploads as image/jpeg, never the client-declared type');
  assert.ok(!/file\.type/.test(r2));
  assert.ok(/prepareSelection\(/.test(read('web/src/app/sell/page.tsx')));
  assert.ok(/prepareSelection\(/.test(read('web/src/app/listing/edit/[id]/page.tsx')));
});

// ── Duplicate publish prevention (store/publishSession.ts) ──────────────────
const tick = () => new Promise((r) => setTimeout(r, 0));

test('rapid double publish taps start exactly one submission', async () => {
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const task = async () => {
    runs++;
    await gate;
  };
  publishOnce(task);
  publishOnce(task); // second tap while the first is in flight
  publishOnce(task); // and a remounted Preview tapping again
  assert.equal(runs, 1);
  assert.equal(usePublishSession.getState().submitting, true);
  release();
  await tick();
  await tick();
  assert.equal(usePublishSession.getState().submitting, false);
});

test('after a failed publish the seller can retry', async () => {
  let runs = 0;
  publishOnce(async () => {
    runs++;
    // a failed attempt reports through notifyFailure and simply returns
  });
  await tick();
  await tick();
  assert.equal(usePublishSession.getState().submitting, false);
  publishOnce(async () => {
    runs++;
  });
  await tick();
  assert.equal(runs, 2);
});

test('a publish that finishes after the seller restarted Sell does not hijack navigation', () => {
  const flow = startPostFlow();
  assert.equal(isActivePostFlow(flow), true);
  startPostFlow();
  assert.equal(isActivePostFlow(flow), false);
});
