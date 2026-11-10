import test from 'node:test';
import assert from 'node:assert/strict';
import { CONCURRENCY, networkRecovered, queuePolicy, type NetSnapshot } from '../lib/imageNetworkPolicy';

const wifi: NetSnapshot = { isConnected: true, isInternetReachable: true, type: 'wifi' };

test('wifi: three downloads; backgrounded: paused', () => {
  assert.deepEqual(queuePolicy(wifi, true), { paused: false, concurrency: CONCURRENCY.normal });
  assert.equal(queuePolicy(wifi, false).paused, true);
});

test('offline, no internet or type none pause the queue; unknown reachability does not', () => {
  assert.equal(queuePolicy({ ...wifi, isConnected: false }, true).paused, true);
  assert.equal(queuePolicy({ ...wifi, isInternetReachable: false }, true).paused, true);
  assert.equal(queuePolicy({ ...wifi, type: 'none' }, true).paused, true);
  assert.equal(queuePolicy({ isConnected: null, isInternetReachable: null, type: 'unknown' }, true).paused, false);
});

test('cellular and metered links download fewer photos at once; 2g/3g one at a time', () => {
  assert.equal(queuePolicy({ ...wifi, type: 'cellular', cellularGeneration: '4g' }, true).concurrency, CONCURRENCY.constrained);
  assert.equal(queuePolicy({ ...wifi, type: 'wifi', expensive: true }, true).concurrency, CONCURRENCY.constrained);
  assert.equal(queuePolicy({ ...wifi, type: 'cellular', cellularGeneration: '3g' }, true).concurrency, CONCURRENCY.slow);
  assert.equal(queuePolicy({ ...wifi, type: 'cellular', cellularGeneration: '2g' }, true).concurrency, CONCURRENCY.slow);
});

test('recovery is paused -> running only', () => {
  const run = { paused: false, concurrency: 3 };
  const stop = { paused: true, concurrency: 3 };
  assert.equal(networkRecovered(stop, run), true);
  assert.equal(networkRecovered(run, run), false);
  assert.equal(networkRecovered(run, stop), false);
  assert.equal(networkRecovered(null, run), false, 'the first reading is not a recovery');
});
