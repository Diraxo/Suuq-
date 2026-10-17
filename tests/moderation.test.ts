import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTIVE_ACCOUNT,
  ModerationNotice,
  SUPPORT_TEAM_LABEL,
  appealKindFor,
  canReply,
  chunkIds,
  createVisibilityGate,
  effectiveAccountState,
  mergeNotice,
  parseVisibilityPayload,
  rowToNotice,
} from '../lib/moderationClient';
import { startVisibilitySync, VisibilityClient } from '../lib/visibilitySync';

const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-05-10T09:00:00Z');

// ---------------------------------------------------------------- account state
test('an expired suspension is treated as active; banned/suspended/active map correctly', () => {
  assert.deepEqual(effectiveAccountState(null), ACTIVE_ACCOUNT);
  assert.deepEqual(effectiveAccountState({ account_status: 'active' }), ACTIVE_ACCOUNT);
  assert.deepEqual(effectiveAccountState({ account_status: 'banned', suspended_until: '2030-01-01T00:00:00Z' }, NOW), { status: 'banned', until: null });
  assert.deepEqual(effectiveAccountState({ account_status: 'suspended', suspended_until: '2026-05-11T00:00:00Z' }, NOW), { status: 'suspended', until: '2026-05-11T00:00:00Z' });
  assert.deepEqual(effectiveAccountState({ account_status: 'suspended', suspended_until: '2026-05-10T09:00:00Z' }, NOW), ACTIVE_ACCOUNT, 'an end date of exactly "now" is over');
  assert.deepEqual(effectiveAccountState({ account_status: 'suspended', suspended_until: '2026-05-01T00:00:00Z' }, NOW), ACTIVE_ACCOUNT);
  assert.deepEqual(effectiveAccountState({ account_status: 'suspended', suspended_until: null }, NOW), { status: 'suspended', until: null }, 'a legacy suspension without an end stays in force');
  assert.deepEqual(effectiveAccountState({ account_status: 'weird' }), ACTIVE_ACCOUNT);
});

// ---------------------------------------------------------------- visibility gate / payload
test('broadcast payloads are validated before use', () => {
  assert.deepEqual(parseVisibilityPayload({ id: ID(1), visible: false, at: 5 }), { id: ID(1), visible: false, at: 5 });
  assert.equal(parseVisibilityPayload(null), null);
  assert.equal(parseVisibilityPayload('x'), null);
  assert.equal(parseVisibilityPayload({ id: 'not-a-uuid', visible: false, at: 1 }), null);
  assert.equal(parseVisibilityPayload({ id: ID(1), visible: 'no', at: 1 }), null);
  assert.equal(parseVisibilityPayload({ id: ID(1), visible: true })?.at, 0, 'a missing timestamp is tolerated');
});

test('the gate drops duplicate and out-of-order events per listing', () => {
  const g = createVisibilityGate();
  assert.equal(g.accept({ id: ID(1), visible: false, at: 100 }), true);
  assert.equal(g.accept({ id: ID(1), visible: false, at: 100 }), false, 'exact duplicate');
  assert.equal(g.accept({ id: ID(1), visible: true, at: 90 }), false, 'older event arriving late');
  assert.equal(g.accept({ id: ID(1), visible: true, at: 101 }), true, 'a genuinely newer event (restore)');
  assert.equal(g.accept({ id: ID(2), visible: false, at: 50 }), true, 'other listings are independent');
});

test('chunkIds de-duplicates and respects the server cap of 200', () => {
  const ids = Array.from({ length: 450 }, (_, i) => ID(i + 1)).concat([ID(1), ID(2)]);
  const chunks = chunkIds(ids);
  assert.deepEqual(chunks.map((c) => c.length), [200, 200, 50]);
  assert.deepEqual(chunkIds([]), []);
});

// ---------------------------------------------------------------- visibility sync with a fake client
function fakeClient(opts: { hidden?: string[]; rpcError?: boolean } = {}) {
  let handler: ((msg: { payload?: unknown }) => void) | null = null;
  let statusCb: ((s: string) => void) | null = null;
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let removed = 0;
  const channel = {
    on: (_t: string, _f: unknown, cb: (msg: { payload?: unknown }) => void) => {
      handler = cb;
      return channel;
    },
    subscribe: (cb: (s: string) => void) => {
      statusCb = cb;
      return channel;
    },
  };
  const client: VisibilityClient = {
    channel: () => channel,
    removeChannel: () => {
      removed++;
    },
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return opts.rpcError ? { data: null, error: { message: 'down' } } : { data: opts.hidden ?? [], error: null };
    },
  };
  return { client, calls, emit: (p: unknown) => handler?.({ payload: p }), status: (s: string) => statusCb?.(s), removed: () => removed };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('a broadcast hides/shows the listing exactly once, even if delivered twice or out of order', async () => {
  const f = fakeClient({ hidden: [ID(1)] });
  const hidden: string[] = [];
  const shown: string[] = [];
  startVisibilitySync(f.client, { onHidden: (id) => hidden.push(id), onShown: (id) => shown.push(id), getKnownIds: () => [] });
  f.emit({ id: ID(1), visible: false, at: 10 });
  f.emit({ id: ID(1), visible: false, at: 10 }); // duplicate (e.g. replay after reconnect)
  f.emit({ id: ID(1), visible: true, at: 5 }); // stale: older than what we already applied
  f.emit({ id: ID(1), visible: true, at: 20 }); // restore
  f.emit({ id: 'garbage', visible: false, at: 30 }); // malformed
  await tick();
  assert.deepEqual(hidden, [ID(1)]);
  assert.deepEqual(shown, [ID(1)]);
  assert.equal(f.calls.length, 1, 'only the one accepted "hidden" event was confirmed with the database');
});

test('a forged "hidden" broadcast cannot hide a live listing (public topic: anyone can publish)', async () => {
  const f = fakeClient({ hidden: [] }); // the database says nothing is hidden
  const hidden: string[] = [];
  startVisibilitySync(f.client, { onHidden: (id) => hidden.push(id), onShown: () => {}, getKnownIds: () => [] });
  f.emit({ id: ID(7), visible: false, at: 123456789 });
  await tick();
  assert.deepEqual(hidden, []);
  assert.equal(f.calls[0].fn, 'hidden_listing_ids');
  assert.deepEqual(f.calls[0].args, { p_ids: [ID(7)] });
});

test('every (re)subscribe reconciles the displayed ids with the database and hides what the server reports', async () => {
  const f = fakeClient({ hidden: [ID(2)] });
  const hidden: string[] = [];
  startVisibilitySync(f.client, { onHidden: (id) => hidden.push(id), onShown: () => {}, getKnownIds: () => [ID(1), ID(2), ID(2)] });
  f.status('CONNECTING'); // not yet connected: nothing happens
  await tick();
  assert.equal(f.calls.length, 0);
  f.status('SUBSCRIBED'); // first connect
  await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].fn, 'hidden_listing_ids');
  assert.deepEqual(f.calls[0].args, { p_ids: [ID(1), ID(2)] });
  assert.deepEqual(hidden, [ID(2)]);
  f.status('CHANNEL_ERROR');
  f.status('SUBSCRIBED'); // automatic reconnect after the socket dropped
  await tick();
  assert.equal(f.calls.length, 2, 'reconnect triggers another reconcile');
});

test('a failed reconciliation never throws or hides anything; stop() detaches', async () => {
  const f = fakeClient({ rpcError: true, hidden: [ID(1)] });
  const hidden: string[] = [];
  const sync = startVisibilitySync(f.client, { onHidden: (id) => hidden.push(id), onShown: () => {}, getKnownIds: () => [ID(1)] });
  await sync.reconcile();
  f.emit({ id: ID(1), visible: false, at: 98 }); // confirmation fails too (offline) -> nothing hidden on a hint alone
  await tick();
  assert.deepEqual(hidden, []);
  sync.stop();
  assert.equal(f.removed(), 1);
  f.emit({ id: ID(1), visible: false, at: 99 });
  await tick();
  assert.deepEqual(hidden, [], 'events after stop() are ignored');
});

test('large known-id sets are reconciled in chunks', async () => {
  const f = fakeClient();
  const ids = Array.from({ length: 430 }, (_, i) => ID(i + 1));
  const sync = startVisibilitySync(f.client, { onHidden: () => {}, onShown: () => {}, getKnownIds: () => ids });
  await sync.reconcile();
  assert.deepEqual(f.calls.map((c) => (c.args.p_ids as string[]).length), [200, 200, 30]);
});

// ---------------------------------------------------------------- notices / support helpers
test('notices merge newest-first without duplicates and map from DB rows', () => {
  const row = (id: string, at: string, extra: Record<string, unknown> = {}) => rowToNotice({ id, kind: 'warning', title: 't', body: 'b', created_at: at, appealable: false, ...extra });
  let list: ModerationNotice[] = [];
  list = mergeNotice(list, row('a', '2026-01-01T00:00:00Z'));
  list = mergeNotice(list, row('b', '2026-01-02T00:00:00Z'));
  list = mergeNotice(list, row('a', '2026-01-01T00:00:00Z', { read_at: '2026-01-03T00:00:00Z' })); // duplicate realtime delivery
  assert.deepEqual(list.map((n) => n.id), ['b', 'a']);
  assert.equal(list[1].readAt, '2026-01-03T00:00:00Z');
  assert.equal(row('c', '2026-01-01T00:00:00Z').fromLabel, SUPPORT_TEAM_LABEL);
});

test('appeals are offered only for the decisions that can be appealed', () => {
  assert.equal(appealKindFor('listing_removed'), 'listing');
  assert.equal(appealKindFor('listing_deactivated'), 'listing');
  assert.equal(appealKindFor('suspension'), 'suspension');
  assert.equal(appealKindFor('ban'), 'ban');
  for (const k of ['warning', 'listing_restored', 'unban', 'appeal_rejected', 'suspension_expired']) assert.equal(appealKindFor(k), null, k);
});

test('a conversation accepts replies until it is closed, or resolved for more than 14 days', () => {
  assert.equal(canReply({ status: 'awaiting_staff' }, NOW), true);
  assert.equal(canReply({ status: 'closed' }, NOW), false);
  assert.equal(canReply({ status: 'resolved', resolvedAt: '2026-05-01T00:00:00Z' }, NOW), true);
  assert.equal(canReply({ status: 'resolved', resolvedAt: '2026-04-20T00:00:00Z' }, NOW), false);
});

// ---------------------------------------------------------------- parity + contracts
test('shared moderation modules are byte-identical on mobile and web', () => {
  const pairs: [string[], string[]][] = [
    [['lib', 'moderationClient.ts'], ['web', 'src', 'lib', 'moderationClient.ts']],
    [['lib', 'visibilitySync.ts'], ['web', 'src', 'lib', 'visibilitySync.ts']],
    [['lib', 'supportApi.ts'], ['web', 'src', 'lib', 'supportApi.ts']],
    [['store', 'visibility.ts'], ['web', 'src', 'store', 'visibility.ts']],
    [['store', 'moderation.ts'], ['web', 'src', 'store', 'moderation.ts']],
  ];
  for (const [a, b] of pairs) assert.equal(read(...a), read(...b), `${a.join('/')} and ${b.join('/')} have drifted — copy the original over the web copy`);
});

test('what a seller sees never says "admin"/"moderator" and always names the Suuqiye Support Team', () => {
  for (const l of ['en', 'so', 'am']) {
    const d = JSON.parse(read('locales', l, 'translation.json'));
    const text = JSON.stringify(d.support) + JSON.stringify(d.errors.classified.restricted);
    assert.doesNotMatch(text, /admin|moderator|moderat/i, `${l}: seller-facing support strings`);
    assert.ok(d.support.thread.team, `${l}: team label`);
  }
  assert.equal(SUPPORT_TEAM_LABEL, 'Suuqiye Support Team');
  for (const f of ['0039_moderation_enforcement.sql', '0040_support_appeals.sql']) {
    const sql = read('supabase', 'migrations', f);
    assert.match(sql, /Suuqiye Support Team/);
  }
  // notices + support messages expose no staff-identifying column to sellers
  const sql0039 = read('supabase', 'migrations', '0039_moderation_enforcement.sql');
  const notices = sql0039.slice(sql0039.indexOf('create table if not exists public.moderation_notices'), sql0039.indexOf('alter table public.moderation_notices enable'));
  assert.doesNotMatch(notices, /actor|admin_id|staff_id|reason text/i);
  const sql0040 = read('supabase', 'migrations', '0040_support_appeals.sql');
  const messages = sql0040.slice(sql0040.indexOf('create table if not exists public.support_messages'), sql0040.indexOf('create table if not exists public.support_message_staff'));
  assert.doesNotMatch(messages, /staff_id|sender|author_id|admin/i);
  // staff never start a conversation: there is no staff "open case"/"start thread" RPC, and nothing writes into chat
  assert.doesNotMatch(sql0040, /staff_open_case|staff_start|insert into public\.(messages|conversations)/i);
});

test('public listing feeds exclude removed/deactivated listings explicitly (owners and staff can read them under RLS)', () => {
  // Mobile no longer downloads the table: its targeted reads (by id, seller, saved-search counts) filter in SQL (0043).
  const targeted = read('supabase', 'migrations', '0043_targeted_listing_reads.sql').match(/status not in \('removed', 'deactivated'\)/g) ?? [];
  assert.ok(targeted.length >= 3, `listings_by_ids, seller_listings and saved_search_counts exclude hidden listings (found ${targeted.length})`);
  const web = read('web', 'src', 'services', 'listings.ts');
  // The website reads public listings through the same RPCs (no direct table query, no load-all).
  assert.match(web, /rpc\('listings_by_ids'/);
  assert.match(web, /rpc\('comparable_listings'/);
  assert.doesNotMatch(web, /from\('listings'\)\.select\('\*'\)\.not\('status'/);
  // Home, category and city feeds are served by home_feed(): the same exclusion lives in the SQL (and its indexes).
  const feedSql = read('supabase', 'migrations', '0042_home_feed.sql');
  const sqlHits = feedSql.match(/status not in \(''?removed''?, ''?deactivated''?\)/g) ?? [];
  assert.ok(sqlHits.length >= 4, `home_feed, home_feed_currencies and the two feed indexes all exclude hidden listings (found ${sqlHits.length})`);
});

test('listing cards and detail pages hide a listing the server has hidden (real-time + reconciled)', () => {
  for (const f of [['components', 'ListingCard.tsx'], ['web', 'src', 'components', 'ListingCard.tsx']]) {
    const src = read(...f);
    assert.match(src, /useVisibilityStore/);
    assert.match(src, /registerKnownListingIds/);
  }
  assert.match(read('web', 'src', 'app', 'listing', '[id]', 'page.tsx'), /hiddenByServer/);
  const layout = read('app', '_layout.tsx');
  assert.match(layout, /startVisibilitySync/);
  assert.match(layout, /AppState\.addEventListener/);
  assert.match(read('web', 'src', 'components', 'ModerationSync.tsx'), /visibilitychange/);
  assert.match(read('web', 'src', 'app', 'layout.tsx'), /<ModerationSync \/>/);
  assert.match(read('web', 'src', 'app', 'layout.tsx'), /<AccountRestrictionBanner \/>/);
});

test('the web admin console is role-aware and every action goes through an RPC', () => {
  const layout = read('web', 'src', 'app', 'admin', 'layout.tsx');
  assert.match(layout, /getStaffRole/);
  assert.match(layout, /STAFF_CAN/);
  const svc = read('web', 'src', 'services', 'admin.ts');
  for (const rpc of ['admin_moderate_listing', 'admin_moderate_user', 'admin_set_verified', 'admin_grant_boost', 'admin_revoke_boost', 'staff_decide_appeal', 'staff_support_reply', 'admin_list_listings', 'admin_listing_detail']) {
    assert.ok(svc.includes(`'${rpc}'`), rpc);
  }
  // admin pages never write moderation state with a plain table update
  for (const f of ['listings/page.tsx', 'listings/[id]/page.tsx', 'users/[id]/page.tsx', 'support/[id]/page.tsx']) {
    assert.doesNotMatch(read('web', 'src', 'app', 'admin', ...f.split('/')), /\.from\('(listings|profiles|reports)'\)\s*\.(update|delete|insert)/, f);
  }
});

test('push notifications route moderation + support taps to the support center', () => {
  const push = read('lib', 'push.ts');
  assert.match(push, /case 'moderation':\s*navigate\('\/support'\)/);
  assert.match(push, /case 'support_reply':/);
});
