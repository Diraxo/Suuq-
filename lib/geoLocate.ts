import { LocCoord, LocIndex } from './locationTree';
import { GeoMatch, matchPoint } from './geoMatch';

// One-off, foreground, approximate device position for "Find listings near me".
// No watchers, no background mode, nothing stored: the coordinates exist only
// inside this function and are reduced to a directory match before returning.
// Must only be called from an explicit user tap — never on launch.

/** Hard stop so a slow GPS fix can't leave the card spinning. */
export const LOCATE_TIMEOUT_MS = 12000;

export type LocateResult =
  | { status: 'match'; match: Extract<GeoMatch, { kind: 'city' }> }
  | { status: 'no-match'; match: Extract<GeoMatch, { kind: 'none' }> }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'services-off' }
  | { status: 'timeout' }
  /** The installed binary has no ExpoLocation native module (built before expo-location was added). Not a permission problem. */
  | { status: 'unsupported' }
  | { status: 'error' };

export type LocationModule = typeof import('expo-location');

/**
 * Loaded on tap, not at import: a dev/store build compiled before expo-location
 * was added throws "Cannot find native module 'ExpoLocation'" on require, which
 * would otherwise take down the whole Home tab at startup. Returns null when the
 * native side is missing so the caller can say so instead of guessing.
 */
export function loadLocationModule(): LocationModule | null {
  try {
    const mod: LocationModule = require('expo-location');
    // Some builds export the JS wrapper but not the native functions.
    return typeof mod?.requestForegroundPermissionsAsync === 'function' ? mod : null;
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export async function locateNearestPlace(
  index: LocIndex,
  coords: Map<string, LocCoord> = new Map(),
  load: () => LocationModule | null = loadLocationModule
): Promise<LocateResult> {
  const Location = load();
  if (!Location) return { status: 'unsupported' };
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { status: 'denied', canAskAgain: perm.canAskAgain };
    if (!(await Location.hasServicesEnabledAsync())) return { status: 'services-off' };

    const pos = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      LOCATE_TIMEOUT_MS
    );
    if (pos === 'timeout') return { status: 'timeout' };

    const match = matchPoint(pos.coords.latitude, pos.coords.longitude, index, coords);
    return match.kind === 'city' ? { status: 'match', match } : { status: 'no-match', match };
  } catch {
    return { status: 'error' };
  }
}
