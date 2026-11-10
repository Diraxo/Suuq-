// How the image queue should behave for a given network / app state. Pure (tests/imageNetworkPolicy.test.ts); the listeners that
// feed it live in lib/imageLifecycle.ts.

export type NetSnapshot = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  /** NetInfo type: wifi, cellular, ethernet, none, unknown ... */
  type: string;
  /** NetInfo: true on metered connections. */
  expensive?: boolean | null;
  /** 2g / 3g / 4g / 5g when the platform reports a cellular generation. */
  cellularGeneration?: string | null;
};

export type QueuePolicy = { paused: boolean; concurrency: number };

export const CONCURRENCY = { normal: 3, constrained: 2, slow: 1 } as const;

/**
 * Backgrounded, offline or no internet: nothing new starts. Slow cellular: one download at a time, so the photo the user is
 * looking at gets the whole link. Other cellular / metered: two. Everything else: three.
 * Unknown reachability (null) is treated as online: a false pause would leave covers blank, a wasted attempt is harmless.
 */
export function queuePolicy(net: NetSnapshot, appActive: boolean): QueuePolicy {
  if (!appActive) return { paused: true, concurrency: CONCURRENCY.normal };
  if (net.isConnected === false || net.isInternetReachable === false || net.type === 'none') return { paused: true, concurrency: CONCURRENCY.slow };
  if (net.type === 'cellular' && (net.cellularGeneration === '2g' || net.cellularGeneration === '3g')) return { paused: false, concurrency: CONCURRENCY.slow };
  if (net.type === 'cellular' || net.expensive === true) return { paused: false, concurrency: CONCURRENCY.constrained };
  return { paused: false, concurrency: CONCURRENCY.normal };
}

/** Whether going from `before` to `after` is a recovery (paused -> running), when failed downloads deserve another chance. */
export function networkRecovered(before: QueuePolicy | null, after: QueuePolicy): boolean {
  return !!before && before.paused && !after.paused;
}
