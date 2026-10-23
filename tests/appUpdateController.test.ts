import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { UpdatePolicy } from '../lib/appUpdate';
import { createUpdateController, FetchResult, FOREGROUND_MIN_INTERVAL_MS, isBlocking, retryDelayMs, STARTUP_WAIT_MS } from '../lib/appUpdateController';

const pol = (over: Partial<UpdatePolicy> = {}): UpdatePolicy => ({
  platform: 'ios', enabled: true, recommendedVersion: null, minimumVersion: '1.1.0', storeUrl: null, message: {}, ...over,
});

// A controllable harness: fake clock, fake timers, scripted fetch results, installed version that can change (store update).
function harness(opts: { installed?: string | null; cache?: UpdatePolicy | null; results?: (FetchResult | 'throw' | 'hang')[] } = {}) {
  let installed = opts.installed === undefined ? '1.0.0' : opts.installed;
  let clock = 1_000_000;
  const results = [...(opts.results ?? [])];
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const saved: UpdatePolicy[] = [];
  let fetches = 0;
  let release: (() => void) | null = null;
  const c = createUpdateController({
    fetchPolicy: async (): Promise<FetchResult> => {
      fetches++;
      const r = results.length > 1 ? results.shift()! : results[0] ?? { ok: false as const };
      if (r === 'throw') throw new Error('network');
      if (r === 'hang') {
        await new Promise<void>((res) => { release = res; });
        return { ok: false };
      }
      return r;
    },
    getInstalledVersion: () => installed,
    loadCache: async () => opts.cache ?? null,
    saveCache: async (p) => { saved.push(p); },
    now: () => clock,
    schedule: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return () => { t.live = false; }; },
  });
  return {
    c, saved, timers,
    fetches: () => fetches,
    setInstalled: (v: string | null) => { installed = v; },
    advance: (ms: number) => { clock += ms; },
    release: () => { (release as (() => void) | null)?.(); },
    fire: (i = timers.length - 1) => { if (timers[i].live) timers[i].fn(); },
  };
}

test('startup: outdated install is blocked after the first fetch; recheck after the store update lifts it', async () => {
  const h = harness({ installed: '1.0.0', results: [{ ok: true, policy: pol() }] });
  await h.c.start();
  assert.equal(isBlocking(h.c.getStatus()), true);
  assert.equal(h.c.getStatus().phase, 'ready');
  // user updates in the store and comes back; no restart, installed version is re-read
  h.setInstalled('1.1.0');
  await h.c.onForeground();
  assert.equal(isBlocking(h.c.getStatus()), false);
  assert.equal(h.c.getStatus().decision.kind, 'ok');
});

test('returning from the store without updating keeps the block (and refetches while blocked)', async () => {
  const h = harness({ results: [{ ok: true, policy: pol() }] });
  await h.c.start();
  const n = h.fetches();
  await h.c.onForeground();
  assert.equal(isBlocking(h.c.getStatus()), true);
  assert.equal(h.fetches(), n + 1, 'a blocked app always rechecks, no throttling');
});

test('operator lowering the minimum frees a blocked user on the next foreground', async () => {
  const h = harness({ results: [{ ok: true, policy: pol() }, { ok: true, policy: pol({ minimumVersion: '1.0.0' }) }] });
  await h.c.start();
  assert.equal(isBlocking(h.c.getStatus()), true);
  await h.c.onForeground();
  assert.equal(isBlocking(h.c.getStatus()), false);
});

test('cached policy decides instantly at startup, before the network answers', async () => {
  const h = harness({ cache: pol(), results: ['hang'] });
  await h.c.start();
  assert.equal(h.c.getStatus().phase, 'ready');
  assert.equal(isBlocking(h.c.getStatus()), true);
  h.release();
});

test('network failure with a cached block stays blocked; failure is never "ok"', async () => {
  const h = harness({ cache: pol(), results: ['throw'] });
  await h.c.start();
  await h.c.retry();
  const s = h.c.getStatus();
  assert.equal(s.decision.kind, 'required');
  assert.equal(s.lastFetchFailed, true);
});

test('network failure with no cache is fail-open but explicitly "unverified", and retries with back-off', async () => {
  const h = harness({ results: ['throw'] });
  await h.c.start();
  const s = h.c.getStatus();
  assert.equal(s.phase, 'ready');
  assert.equal(s.decision.kind, 'unverified');
  assert.equal(s.lastFetchFailed, true);
  const retry = h.timers[h.timers.length - 1];
  assert.equal(retry.ms, retryDelayMs(0));
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(retryDelayMs), [15_000, 30_000, 60_000, 120_000, 240_000, 300_000]);
});

test('a scheduled retry that succeeds turns "unverified" into a real decision, including a block', async () => {
  const h = harness({ results: [{ ok: false }, { ok: true, policy: pol() }] });
  await h.c.start();
  assert.equal(h.c.getStatus().decision.kind, 'unverified');
  h.fire();
  await new Promise((r) => setImmediate(r));
  assert.equal(isBlocking(h.c.getStatus()), true);
});

test('invalid server responses (parsed as { ok: false }) never produce a policy or a block', async () => {
  const h = harness({ results: [{ ok: false }] });
  await h.c.start();
  assert.equal(h.c.getStatus().decision.kind, 'unverified');
  assert.equal(h.saved.length, 0, 'nothing invalid is cached');
});

test('slow first-ever launch: app is held until the startup limit, then continues unverified', async () => {
  const h = harness({ results: ['hang'] });
  const started = h.c.start();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.c.getStatus().phase, 'checking');
  h.fire(0); // startup time limit
  assert.equal(h.c.getStatus().phase, 'ready');
  assert.equal(h.c.getStatus().decision.kind, 'unverified');
  assert.ok(STARTUP_WAIT_MS <= 5000);
  h.release();
  await started;
});

test('healthy policy is not refetched on every foreground, but is after the interval', async () => {
  const h = harness({ installed: '1.1.0', results: [{ ok: true, policy: pol() }] });
  await h.c.start();
  await h.c.onForeground();
  await h.c.onForeground();
  assert.equal(h.fetches(), 1);
  h.advance(FOREGROUND_MIN_INTERVAL_MS + 1);
  await h.c.onForeground();
  assert.equal(h.fetches(), 2);
});

test('concurrent checks share one request', async () => {
  const h = harness({ results: [{ ok: true, policy: pol() }] });
  await Promise.all([h.c.start(), h.c.retry(), h.c.retry()]);
  assert.equal(h.fetches(), 1);
});

test('successful policies are cached; subscribers are notified', async () => {
  const h = harness({ results: [{ ok: true, policy: pol() }] });
  let calls = 0;
  const off = h.c.subscribe(() => calls++);
  await h.c.start();
  assert.equal(h.saved.length, 1);
  assert.ok(calls > 0);
  off();
});

test('the block does not depend on sign-in, deep links or notifications: only version + policy decide', async () => {
  // The controller has no notion of a session, route or push payload, so none of them can lift a block.
  const h = harness({ results: [{ ok: true, policy: pol() }] });
  await h.c.start();
  for (let i = 0; i < 3; i++) await h.c.onForeground(); // e.g. foreground via a deep link / notification tap / OAuth return
  assert.equal(isBlocking(h.c.getStatus()), true);
});

// Structural checks on the wiring that unit tests of the pure controller cannot see.
// Compiled tests live in .test-build/tests, so the repo root is two levels up.
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

test('wiring: root layout mounts the gate, withholds auth prompt / banners while held, and starts the check', () => {
  const layout = read('app/_layout.tsx');
  assert.match(layout, /<UpdateRequiredGate \/>/);
  assert.match(layout, /startAppUpdateCheck/);
  assert.match(layout, /held \? null : <AuthPromptModal \/>/);
  assert.match(layout, /held \? null : <PushBanner \/>/);
  assert.match(layout, /held \? null : <SnackbarHost \/>/);
  assert.match(layout, /no-hide-descendants/);
});

test('wiring: the splash redirect waits for the policy, and the existing splash fixes are untouched', () => {
  const index = read('app/index.tsx');
  assert.match(index, /minDelayDone && !authInitializing && languageHydrated && onboarded !== null && updateChecked/);
  assert.match(index, /SplashScreen\.hideAsync\(\)\.catch\(\(\) => \{\}\)/);
  const layout = read('app/_layout.tsx');
  assert.match(layout, /SplashScreen\.preventAutoHideAsync\(\)/);
  assert.match(layout, /if \(pathname !== '\/'\) SplashScreen\.hideAsync\(\)/);
  assert.match(layout, /setTimeout\(\(\) => SplashScreen\.hideAsync\(\)\.catch\(\(\) => \{\}\), 6000\)/);
});

test('wiring: the screen is a non-dismissible modal that swallows hardware back', () => {
  const gate = read('components/UpdateRequiredGate.tsx');
  assert.match(gate, /onRequestClose=\{\(\) => \{\}\}/);
  assert.match(gate, /hardwareBackPress', \(\) => true/);
  assert.doesNotMatch(gate, /onDismiss|router\./);
});

test('wiring: the app only ever reads the policy table with the anon client', () => {
  const store = read('store/appUpdate.ts');
  assert.match(store, /\.from\('app_update_policy'\)\s*\.select\(/);
  assert.doesNotMatch(store, /\.(insert|update|upsert|delete|rpc)\(/);
  assert.doesNotMatch(store, /service_role|SERVICE_ROLE/i);
});
