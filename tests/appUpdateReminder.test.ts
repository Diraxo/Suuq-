import test from 'node:test';
import assert from 'node:assert/strict';
import { OptionalUpdate } from '../lib/appUpdate';
import { createReminderStore, isReminderDue, reminderKey, ReminderState } from '../lib/appUpdateReminder';

const H = 3_600_000;
const update = (over: Partial<OptionalUpdate> = {}): OptionalUpdate => ({
  kind: 'optional', tier: 'normal', targetVersion: '1.1.0', release: null, storeUrl: null, reminderIntervalHours: 72, firstReminderDelayHours: 0, showWhatsNew: true, ...over,
});

function harness(initial: ReminderState = {}, startAt = 1_000_000_000_000) {
  let clock = startAt;
  let disk: ReminderState = JSON.parse(JSON.stringify(initial));
  let saves = 0;
  const make = () => createReminderStore({ load: async () => JSON.parse(JSON.stringify(disk)), save: async (s) => { saves++; disk = JSON.parse(JSON.stringify(s)); }, now: () => clock });
  return { store: make(), restart: make, advance: (ms: number) => { clock += ms; }, disk: () => disk, saves: () => saves, now: () => clock };
}

test('first sight with no delay: shown, and not again in the same session', async () => {
  const h = harness();
  assert.equal(await h.store.shouldShow('android', update()), true);
  assert.equal(await h.store.shouldShow('android', update()), false, 'navigation / re-render must not repeat it');
  assert.equal(await h.store.shouldShow('android', update()), false);
});

test('Remind me later: silent for the whole interval (also across restarts), then due again', async () => {
  const h = harness();
  const u = update();
  assert.equal(await h.store.shouldShow('android', u), true);
  const { remindAfter, dismissedAt } = await h.store.dismiss('android', u);
  assert.equal(remindAfter - dismissedAt, 72 * H);
  h.advance(71 * H);
  assert.equal(await h.restart().shouldShow('android', u), false, 'new session, still inside the 3-day interval');
  h.advance(2 * H);
  assert.equal(await h.restart().shouldShow('android', u), true, 'interval elapsed');
});

test('important releases use their own (shorter) interval', async () => {
  const h = harness();
  const u = update({ tier: 'important', reminderIntervalHours: 24 });
  await h.store.dismiss('ios', u);
  h.advance(23 * H);
  assert.equal(await h.restart().shouldShow('ios', u), false);
  h.advance(2 * H);
  assert.equal(await h.restart().shouldShow('ios', u), true);
});

test('first-reminder delay: silent until the delay passes, counted from first sight', async () => {
  const h = harness();
  const u = update({ firstReminderDelayHours: 48 });
  assert.equal(await h.store.shouldShow('android', u), false);
  h.advance(47 * H);
  assert.equal(await h.restart().shouldShow('android', u), false);
  h.advance(2 * H);
  assert.equal(await h.restart().shouldShow('android', u), true);
});

test('a newer release or target version starts a fresh cycle; platforms are separate', async () => {
  const h = harness();
  const a = update({ release: null, targetVersion: '1.1.0' });
  await h.store.dismiss('android', a);
  assert.equal(await h.restart().shouldShow('android', update({ targetVersion: '1.2.0' })), true);
  assert.equal(await h.restart().shouldShow('ios', a), true, 'the iOS reminder is independent');
  assert.notEqual(reminderKey('android', a), reminderKey('ios', a));
});

test('a clock moved far back (remindAfter beyond one interval) cannot silence the reminder forever', () => {
  const now = 5_000_000_000_000;
  assert.equal(isReminderDue(update(), { firstSeenAt: now, dismissedAt: now, remindAfter: now + 500 * H }, now), true);
  assert.equal(isReminderDue(update(), { firstSeenAt: now, dismissedAt: now, remindAfter: now + 10 * H }, now), false);
});

test('storage failures never throw and never crash the app', async () => {
  const s = createReminderStore({ load: async () => { throw new Error('disk'); }, save: async () => { throw new Error('full'); }, now: () => 1 });
  assert.equal(await s.shouldShow('android', update()), true);
  await s.dismiss('android', update());
});

test('old records are pruned so storage stays bounded', async () => {
  const h = harness();
  for (let i = 0; i < 40; i++) {
    await h.store.dismiss('android', update({ targetVersion: `1.${i}.0` }));
    h.advance(1000);
  }
  assert.ok(Object.keys(h.disk()).length <= 20);
  assert.ok(reminderKey('android', update({ targetVersion: '1.39.0' })) in h.disk(), 'newest records survive');
});
