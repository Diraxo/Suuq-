import { AppState } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { forgetImageFailures, setImageQueuePolicy } from '@/lib/imagePrefetch';
import { networkRecovered, queuePolicy, type NetSnapshot, type QueuePolicy } from '@/lib/imageNetworkPolicy';

let stop: (() => void) | null = null;

/** Wires the image queue to the app state and the network. Idempotent; returns the unsubscribe. Call once from the root layout. */
export function startImageLifecycle(): () => void {
  if (stop) return stop;
  let net: NetSnapshot = { isConnected: null, isInternetReachable: null, type: 'unknown' };
  let active = AppState.currentState !== 'background';
  let last: QueuePolicy | null = null;

  const apply = () => {
    const next = queuePolicy(net, active);
    setImageQueuePolicy(next);
    // Back online / foregrounded: give downloads that gave up during the outage another chance.
    if (networkRecovered(last, next)) forgetImageFailures();
    last = next;
  };

  const onNet = (s: NetInfoState) => {
    const details = (s as { details?: { isConnectionExpensive?: boolean; cellularGeneration?: string | null } | null }).details;
    net = {
      isConnected: s.isConnected,
      isInternetReachable: s.isInternetReachable,
      type: s.type,
      expensive: details?.isConnectionExpensive ?? null,
      cellularGeneration: details?.cellularGeneration ?? null,
    };
    apply();
  };

  const unsubNet = NetInfo.addEventListener(onNet);
  const sub = AppState.addEventListener('change', (state) => {
    active = state === 'active';
    apply();
  });
  apply();

  stop = () => {
    unsubNet();
    sub.remove();
    stop = null;
  };
  return stop;
}
