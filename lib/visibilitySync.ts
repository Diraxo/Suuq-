// Real-time listing visibility, platform-neutral (identical copy at web/src/lib/visibilitySync.ts; keep in sync).
//
// Two independent mechanisms, because either one alone can miss something:
//  1. Broadcast: the database announces {id, visible, at} on 'listings:visibility' when a listing is removed,
//     deactivated, restored or deleted. (postgres_changes cannot do this: Realtime applies RLS, and once a
//     listing is hidden nobody but its owner/staff may read it, so buyers would receive no event at all.)
//     The topic is public, which means ANY client can publish to it. A broadcast is therefore only a HINT: a
//     "hidden" event is confirmed with hidden_listing_ids() before anything is hidden, and a "visible" event
//     only triggers a refetch - so a forged event can cost one extra request, never hide a live listing.
//  2. Reconciliation: on every (re)subscribe and whenever the app returns to the foreground we ask the
//     database which of the ids we currently show are no longer visible (hidden_listing_ids). This heals a
//     missed event, a dropped connection and any stale cache.
// Consumers are idempotent (hiding an id twice is harmless) and the gate drops duplicate/out-of-order events.
import { chunkIds, createVisibilityGate, parseVisibilityPayload, VISIBILITY_EVENT, VISIBILITY_TOPIC } from './moderationClient';

/** The small slice of the Supabase client this module needs — keeps it testable without the SDK. */
export type VisibilityClient = {
  channel: (name: string, opts?: unknown) => any;
  removeChannel: (ch: any) => unknown;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};

export type VisibilityHandlers = {
  onHidden: (id: string) => void;
  onShown: (id: string) => void;
  /** Ids currently displayed anywhere (feed, search, favorites…). Reconciled against the database. */
  getKnownIds: () => string[];
};

export function startVisibilitySync(client: VisibilityClient, h: VisibilityHandlers): { stop: () => void; reconcile: () => Promise<void> } {
  const gate = createVisibilityGate();
  let stopped = false;

  const confirmHidden = async (id: string) => {
    try {
      const { data, error } = await client.rpc('hidden_listing_ids', { p_ids: [id] });
      if (!stopped && !error && Array.isArray(data) && data.includes(id)) h.onHidden(id);
    } catch {
      /* offline: the reconnect reconciliation will catch it */
    }
  };

  const handle = (payload: unknown) => {
    if (stopped) return;
    const e = parseVisibilityPayload(payload);
    if (!e || !gate.accept(e)) return;
    if (e.visible) h.onShown(e.id);
    else void confirmHidden(e.id);
  };

  const reconcile = async () => {
    for (const ids of chunkIds(h.getKnownIds())) {
      if (stopped) return;
      try {
        const { data, error } = await client.rpc('hidden_listing_ids', { p_ids: ids });
        if (error || !Array.isArray(data)) continue; // a failed heal is retried on the next trigger
        for (const id of data as string[]) if (!stopped) h.onHidden(id);
      } catch {
        /* offline — retried on reconnect */
      }
    }
  };

  const channel = client
    .channel(VISIBILITY_TOPIC, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: VISIBILITY_EVENT }, (msg: { payload?: unknown }) => handle(msg?.payload))
    .subscribe((status: string) => {
      // SUBSCRIBED fires on the first connect AND after every automatic reconnect: events published while the
      // socket was down are gone, so reconcile.
      if (status === 'SUBSCRIBED') void reconcile();
    });

  return {
    stop: () => {
      stopped = true;
      client.removeChannel(channel);
    },
    reconcile,
  };
}
