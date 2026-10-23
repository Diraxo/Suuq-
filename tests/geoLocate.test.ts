import test from 'node:test';
import assert from 'node:assert/strict';
import { LocationModule, locateNearestPlace } from '../lib/geoLocate';
import { buildIndex } from '../lib/locationTree';

const index = buildIndex([]);

function fake(over: Record<string, unknown>): () => LocationModule {
  return () =>
    ({
      requestForegroundPermissionsAsync: async () => ({ status: 'granted', canAskAgain: true }),
      hasServicesEnabledAsync: async () => true,
      getCurrentPositionAsync: async () => ({ coords: { latitude: 9.56, longitude: 44.06 } }),
      Accuracy: { Balanced: 3 },
      ...over,
    }) as unknown as LocationModule;
}

test('missing native module is reported as unsupported, not denied or error', async () => {
  assert.deepEqual(await locateNearestPlace(index, new Map(), () => null), { status: 'unsupported' });
});

test('permission denial stays a denial', async () => {
  const r = await locateNearestPlace(index, new Map(), fake({ requestForegroundPermissionsAsync: async () => ({ status: 'denied', canAskAgain: false }) }));
  assert.deepEqual(r, { status: 'denied', canAskAgain: false });
});

test('services off is reported', async () => {
  assert.deepEqual(await locateNearestPlace(index, new Map(), fake({ hasServicesEnabledAsync: async () => false })), { status: 'services-off' });
});

test('a position outside an empty directory is no-match, never a crash', async () => {
  assert.equal((await locateNearestPlace(index, new Map(), fake({}))).status, 'no-match');
});

test('native call failure is a generic error', async () => {
  const r = await locateNearestPlace(index, new Map(), fake({ getCurrentPositionAsync: async () => { throw new Error('x'); } }));
  assert.deepEqual(r, { status: 'error' });
});
