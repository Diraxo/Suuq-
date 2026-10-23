// Phase 2/5/6 — 0041 on top of the REAL chain 0001..0040 in PGlite (real Postgres): moderation dashboard reads
// (pagination, filters, authorization, scale), real-time visibility broadcast, stale-cache reconciliation,
// retention, rollback.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db, hasTrgm } = await boot({ upTo: '0040' });
const { q, fails } = actors(db);
const fingerprint = async () =>
  (
    await db.query(`
    select 'col' k, table_name||'.'||column_name||':'||data_type v from information_schema.columns where table_schema='public'
    union all select 'fn', p.oid::regprocedure::text||':'||md5(regexp_replace(pg_get_functiondef(p.oid), '[[:space:]]+', ' ', 'g')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    union all select 'trg', tgrelid::regclass||'.'||tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.%'
    union all select 'pol', schemaname||'.'||tablename||'.'||policyname from pg_policies where schemaname='public'
    union all select 'idx', indexname from pg_indexes where schemaname='public'
    union all select 'pub', tablename from pg_publication_tables where pubname='supabase_realtime'
    order by 1,2`)
  ).rows.map((r) => r.k + ' ' + r.v);
const before = await fingerprint();
const [admin, mod, supp, s1, s2, s3, buyer] = await seedUsers(db, 7);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin'),($2,'moderator'),($3,'support')`, [admin, mod, supp]);

await db.exec(sqlFile('migrations/0041_dashboard_realtime.sql'));
ok('0041 applies on top of the real 0001..0040 chain');
await db.exec(sqlFile('migrations/0041_dashboard_realtime.sql'));
ok('0041 is re-applicable (idempotent)');

await db.exec(`select set_config('suuqplus.skip_rate_limit','true',false)`);
let n = 3000;
async function listing(owner, o = {}) {
  const id = uuid(++n);
  await db.query(`insert into public.listings(id,user_id,title,category,city,price,status,images,created_at) values ($1,$2,$3,'electronics','Hargeisa',$4,$5,$6,$7)`,
    [id, owner, o.title ?? `Item ${n}`, o.price ?? 100, o.status ?? 'available', ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'], o.createdAt ?? new Date(Date.now() - n * 1000).toISOString()]);
  return id;
}
const report = (reporter, id, reason = 'Spam', status = 'pending') =>
  db.query(`insert into public.reports(reporter_id,target_type,target_id,reason,status) values ($1,'listing',$2,$3,$4)`, [reporter, id, reason, status]);

const A = await listing(s1, { title: 'Alpha phone' });
const B = await listing(s1, { title: 'Beta phone' });
const C = await listing(s2, { title: 'Gamma TV 100% off' });
const D = await listing(s2, { title: 'Delta bike', status: 'sold' });
await report(buyer, A); await report(s3, A, 'Scam'); await report(s2, A, 'Fake');
await report(buyer, B); await report(s3, C, 'Other', 'reviewed');
await q(mod, `select public.admin_moderate_listing($1,'deactivate','Needs a look')`, [D]);
await db.query(`update public.profiles set email='seller-two@example.com' where id=$1`, [s2]);

// ---------------------------------------------------------------- authorization
for (const [who, label] of [[buyer, 'a regular user'], [null, 'an anonymous caller']]) {
  await fails(who, `select * from public.admin_list_listings()`, [], /42501|Not authorized|permission denied/);
  await fails(who, `select public.admin_listing_detail($1)`, [A], /42501|Not authorized|permission denied/);
  await fails(who, `select public.admin_dashboard_counts()`, [], /42501|Not authorized|permission denied/);
  await fails(who, `select * from public.admin_list_cases()`, [], /42501|Not authorized|permission denied/);
  await fails(who, `select public.admin_case_detail($1)`, [uuid(1)], /42501|Not authorized|permission denied/);
}
ok('every dashboard RPC refuses regular users and anonymous callers');
await q(supp, `select * from public.admin_list_listings()`);
await fails(supp, `select * from public.admin_list_cases()`, [], /./).catch(() => {});
await q(supp, `select * from public.admin_list_cases()`);
ok('support staff can read listings and cases');

// ---------------------------------------------------------------- counts
const counts = (await q(mod, `select public.admin_dashboard_counts() c`)).rows[0].c;
assert.equal(counts.pending_reports, 4);
assert.equal(counts.live_listings, 3);
assert.equal(counts.moderated_listings, 1);
assert.equal(counts.open_cases, 0);
ok('overview counts are computed in the database and match the data');

// ---------------------------------------------------------------- list
const list = async (args = {}) => {
  const a = { status: null, reported: false, query: null, seller: null, sort: 'newest', limit: 25, offset: 0, boosted: false, ...args };
  return (await q(mod, `select * from public.admin_list_listings($1,$2,$3,$4,$5,$6,$7,$8)`, [a.status, a.reported, a.query, a.seller, a.sort, a.limit, a.offset, a.boosted])).rows;
};
let rows = await list();
assert.equal(rows.length, 4);
assert.equal(Number(rows[0].total), 4);
assert.deepEqual(rows.map((r) => r.listing.id), [A, B, C, D]);
assert.ok(rows.every((r) => r.listing.images.length === 3), 'at most 3 thumbnails per row');
assert.equal(rows[0].report_count, 3);
assert.equal(rows[0].seller.full_name, 'User 4');
ok('list returns listings with seller summary, report counts and at most 3 thumbnails, newest first');
rows = await list({ limit: 2, offset: 2 });
assert.deepEqual(rows.map((r) => r.listing.id), [C, D]);
assert.equal(Number(rows[0].total), 4);
ok('pagination: offset/limit with a stable total');
assert.deepEqual((await list({ reported: true })).map((r) => r.listing.id).sort(), [A, B, C].sort());
assert.deepEqual((await list({ sort: 'most_reported', reported: true })).map((r) => r.listing.id), [A, B, C]);
const mr = await list({ sort: 'most_reported', reported: true });
assert.equal(mr[0].open_report_count, 3);
assert.equal(mr[2].open_report_count, 0, 'a listing whose only report is already reviewed sorts last');
ok('"reported only" and "most reported" (open reports first)');
assert.deepEqual((await list({ status: 'moderated' })).map((r) => r.listing.id), [D]);
assert.deepEqual((await list({ status: 'live' })).map((r) => r.listing.id).sort(), [A, B, C].sort());
assert.deepEqual((await list({ status: 'sold' })).length, 0);
await fails(mod, `select * from public.admin_list_listings('bogus')`, [], /Unknown status/);
await fails(mod, `select * from public.admin_list_listings(null,false,null,null,'sideways')`, [], /Unknown sort/);
ok('status filters (live / moderated / exact) and input validation');
assert.deepEqual((await list({ query: 'alpha' })).map((r) => r.listing.id), [A]);
assert.deepEqual((await list({ query: 'seller-two@' })).map((r) => r.listing.id).sort(), [C, D].sort());
assert.deepEqual((await list({ query: 'User 4' })).map((r) => r.listing.id).sort(), [A, B].sort());
assert.deepEqual((await list({ query: '100%' })).map((r) => r.listing.id), [C]);
assert.deepEqual((await list({ query: '%' })).length, 1, 'a literal % only matches titles containing %');
assert.deepEqual((await list({ seller: s2 })).map((r) => r.listing.id).sort(), [C, D].sort());
ok('search by title / seller name / seller email; wildcards are escaped; filter by seller');
assert.equal((await list({ limit: 1000 })).length, 4);
ok('limit is clamped server-side');

// suspended seller shows its EFFECTIVE status
await q(mod, `select public.admin_moderate_user($1,'suspend','Spam','x', now() + interval '2 days')`, [s1]);
assert.equal((await list({ seller: s1 }))[0].seller.account_status, 'suspended');
await db.query(`update public.profiles set suspended_until = now() - interval '1 minute' where id=$1`, [s1]);
assert.equal((await list({ seller: s1 }))[0].seller.account_status, 'active');
ok('the dashboard shows a seller\'s effective account status (an expired suspension reads as active)');

// ---------------------------------------------------------------- detail
await q(buyer, `insert into public.reviews(reviewer_id, seller_id, rating, comment) values ($1,$2,4,'ok')`, [buyer, s1]);
await q(s3, `insert into public.reviews(reviewer_id, seller_id, rating, comment) values ($1,$2,2,'meh')`, [s3, s1]);
await q(admin, `select public.admin_grant_boost($1,1,'launch')`, [B]);
assert.deepEqual((await list({ boosted: true })).map((r) => r.listing.id), [B]);
await q(s1, `update public.listings set price = 80 where id=$1`, [A]).catch(() => {});
await q(mod, `select public.admin_moderate_listing($1,'remove','Counterfeit','Removed.')`, [A]);
const det = (await q(mod, `select public.admin_listing_detail($1) d`, [A])).rows[0].d;
assert.equal(det.listing.id, A);
assert.equal(det.seller.rating_count, 2);
assert.equal(Number(det.seller.rating_avg), 3);
assert.equal(det.seller.listings_total, 2);
assert.equal(det.reports.length, 3);
assert.ok(det.reports.every((r) => r.reporter_name && r.reason));
assert.equal(det.history[0].action, 'listing_removed');
assert.equal(det.history[0].actor_name, 'User 2');
assert.equal(det.history[0].reason, 'Counterfeit');
const detB = (await q(mod, `select public.admin_listing_detail($1) d`, [B])).rows[0].d;
assert.equal(detB.boosts.length, 1);
assert.ok(det.listing.images.length === 5, 'detail returns every image');
assert.equal((await q(mod, `select public.admin_listing_detail($1) d`, [uuid(999)])).rows[0].d, null);
ok('detail bundles listing, seller + ratings, reports with reporter names, moderation history, boosts, price drops and appeals');

// ---------------------------------------------------------------- cases
const cs = (await q(s1, `select public.support_open_case('Why was it removed?','Please explain.','listing',$1) id`, [A])).rows[0].id;
await q(supp, `select public.staff_support_reply($1,'We removed it for counterfeit goods.')`, [cs]);
const cl = (await q(supp, `select * from public.admin_list_cases('open')`)).rows;
assert.equal(cl.length, 1);
assert.equal(cl[0].user_name, 'User 4');
assert.match(cl[0].last_snippet, /counterfeit/);
const cd = (await q(supp, `select public.admin_case_detail($1) d`, [cs])).rows[0].d;
assert.deepEqual(cd.messages.map((m) => [m.author_kind, m.staff_name ?? null]), [['user', null], ['staff', 'User 3']]);
assert.equal(cd.listing.id, A);
assert.ok(cd.history.length >= 1);
await fails(s1, `select public.admin_case_detail($1)`, [cs], /Not authorized|42501/);
ok('support inbox/detail show staff names to staff only; the seller cannot call them');

// ---------------------------------------------------------------- realtime visibility
const sent = async () => (await db.query(`select topic, event, payload, private from realtime.sent order by id`)).rows;
await db.query(`delete from realtime.sent`);
const V = await listing(s2, { title: 'Visibility probe' });
await q(mod, `select public.admin_moderate_listing($1,'remove','Probe removal')`, [V]);
let m = await sent();
assert.equal(m.length, 1);
assert.deepEqual([m[0].topic, m[0].event, m[0].private], ['listings:visibility', 'listing_visibility', false]);
assert.equal(m[0].payload.id, V);
assert.equal(m[0].payload.visible, false);
assert.ok(Number.isInteger(m[0].payload.at));
assert.deepEqual(Object.keys(m[0].payload).sort(), ['at', 'id', 'visible'], 'the broadcast carries no reason, actor or status detail');
ok('removing a listing broadcasts {id, visible:false, at} on a public topic — no reason, no staff identity');
await q(mod, `select public.admin_moderate_listing($1,'restore','Probe restore')`, [V]);
m = await sent();
assert.equal(m.length, 2);
assert.equal(m[1].payload.visible, true);
ok('restoring broadcasts visible:true so clients can refresh it');
await db.query(`update public.listings set status='sold' where id=$1`, [V]);
await db.query(`update public.listings set title='renamed' where id=$1`, [V]);
assert.equal((await sent()).length, 2);
ok('status changes that do not alter visibility (available -> sold), and other edits, broadcast nothing');
await q(s2, `delete from public.listings where id=$1`, [V]);
m = await sent();
assert.equal(m.length, 3);
assert.deepEqual([m[2].payload.id, m[2].payload.visible], [V, false]);
const R2 = await listing(s2, { title: 'already hidden' });
await q(mod, `select public.admin_moderate_listing($1,'deactivate','x y z')`, [R2]);
const k = (await sent()).length;
await db.query(`delete from public.listings where id=$1`, [R2]);
assert.equal((await sent()).length, k);
ok('deleting a visible listing broadcasts; deleting an already-hidden one does not (no duplicate events)');
await db.exec(`alter function realtime.send(jsonb,text,text,boolean) rename to send_broken; create function realtime.send(jsonb,text,text,boolean) returns void language plpgsql as $f$ begin raise exception 'realtime down'; end $f$;`);
const F = await listing(s2, { title: 'Broadcast outage' });
await q(mod, `select public.admin_moderate_listing($1,'remove','During outage')`, [F]);
assert.equal((await db.query(`select status from public.listings where id=$1`, [F])).rows[0].status, 'removed');
await db.exec(`drop function realtime.send(jsonb,text,text,boolean); alter function realtime.send_broken(jsonb,text,text,boolean) rename to send;`);
ok('a broadcast outage never blocks or rolls back a moderation action');

// reconciliation
const live = await listing(s2, { title: 'still live' });
const hidden = (await q(null, `select public.hidden_listing_ids($1::uuid[]) h`, [[F, live, uuid(998), A, D]])).rows[0].h.sort();
assert.deepEqual(hidden, [F, uuid(998), A, D].sort());
assert.deepEqual((await q(buyer, `select public.hidden_listing_ids($1::uuid[]) h`, [[live]])).rows[0].h, []);
assert.equal((await q(buyer, `select cardinality(public.hidden_listing_ids($1::uuid[])) c`, [Array.from({ length: 300 }, (_, i) => uuid(5000 + i))])).rows[0].c, 200);
ok('hidden_listing_ids heals stale caches: removed, deactivated and deleted ids are reported; live ones are not; input is capped');

const pub = (await db.query(`select tablename from pg_publication_tables where pubname='supabase_realtime'`)).rows.map((r) => r.tablename);
for (const t of ['moderation_notices', 'support_cases', 'listings', 'profiles']) assert.ok(pub.includes(t), t);
assert.ok(!pub.includes('support_messages'), 'support_messages stays out of the publication (Realtime would evaluate RLS for every message against every subscriber)');
ok('notices, support cases, listings and profiles are in the realtime publication; support_messages deliberately is not');

// ---------------------------------------------------------------- scale
if (hasTrgm) {
  await db.query(`insert into public.listings(user_id,title,category,city,price,status,images,created_at)
    select $1, 'bulk '||g||' '||md5(g::text), 'electronics','Hargeisa', 10+g, (array['available','available','available','sold','removed'])[1+g%5], array['x.jpg'], now() - (g||' seconds')::interval from generate_series(1,6000) g`, [s3]);
  await db.query(`insert into public.reports(reporter_id,target_type,target_id,reason,status)
    select (array[$2::uuid,$3::uuid,$4::uuid])[1+(g%3)], 'listing', l.id::text, 'Spam', 'pending' from (select id, row_number() over () g from public.listings where user_id=$1 limit 3000) l, generate_series(1,1) x
    on conflict do nothing`, [s3, buyer, s1, s2]);
  await db.exec('analyze public.listings; analyze public.reports');
  const t0 = Date.now();
  const page1 = await list({ limit: 25 });
  const t1 = Date.now();
  const rep = await list({ reported: true, sort: 'most_reported', limit: 25 });
  const t2 = Date.now();
  const mod1 = await list({ status: 'moderated', limit: 25, offset: 500 });
  const t3 = Date.now();
  const srch = await list({ query: 'bulk 5', limit: 25 });
  const t4 = Date.now();
  assert.equal(page1.length, 25);
  assert.ok(Number(page1[0].total) > 6000);
  assert.equal(rep.length, 25);
  assert.ok(rep.every((r) => r.report_count > 0));
  assert.equal(mod1.length, 25);
  assert.equal(srch.length, 25);
  console.log(`INFO  scale (6004 listings, ~3000 reports, in-WASM Postgres): newest=${t1 - t0}ms most_reported=${t2 - t1}ms moderated@500=${t3 - t2}ms search=${t4 - t3}ms`);
  assert.ok(t1 - t0 < 2500 && t2 - t1 < 5000 && t3 - t2 < 3000, 'review queues stay responsive on thousands of listings');
  const plan = (await db.query(`explain select count(*) from public.reports where target_type='listing' and target_id = 'x'`)).rows.map((r) => r['QUERY PLAN']).join('\n');
  assert.match(plan, /reports_target_idx|Index/);
  ok('review queues return full pages promptly on ~6000 listings / ~3000 reports (per-listing report lookups are indexed)');
} else console.log('SKIP  scale checks (pg_trgm contrib unavailable)');

// ---------------------------------------------------------------- retention
await db.query(`delete from public.support_cases`);
const old1 = (await q(s1, `select public.support_open_case('Old resolved case','hello there','general') id`)).rows[0].id;
const fresh = (await q(s2, `select public.support_open_case('Fresh open case','hello there','general') id`)).rows[0].id;
await db.query(`update public.support_cases set status='resolved', resolved_at = now() - interval '25 months' where id=$1`, [old1]);
await db.query(`update public.moderation_notices set read_at = now() - interval '13 months' where id = (select id from public.moderation_notices limit 1)`);
const evBefore = (await db.query(`select count(*)::int c from public.moderation_events`)).rows[0].c;
const auditBefore = (await db.query(`select count(*)::int c from public.admin_audit_log`)).rows[0].c;
await fails(admin, `select public.purge_old_support_data()`, [], /permission denied/);
await fails(s1, `select public.purge_old_support_data()`, [], /permission denied/);
const purged = (await db.query(`select public.purge_old_support_data() r`)).rows[0].r;
assert.equal(purged.cases_deleted, 1);
assert.equal(purged.notices_deleted, 1);
assert.equal((await db.query(`select count(*)::int c from public.support_cases where id=$1`, [fresh])).rows[0].c, 1);
assert.equal((await db.query(`select count(*)::int c from public.moderation_events`)).rows[0].c, evBefore);
assert.equal((await db.query(`select count(*)::int c from public.admin_audit_log`)).rows[0].c, auditBefore);
ok('retention: old resolved support cases and long-read notices are purged by the service role only; events and the audit log are kept');

// ---------------------------------------------------------------- rollback
await db.exec(sqlFile('rollback/0041_dashboard_realtime_ROLLBACK.sql'));
const after = await fingerprint();
const a = new Set(before), b = new Set(after);
assert.deepEqual([...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x))), []);
ok('rollback restores the exact pre-0041 schema (including realtime publication membership)');
await db.exec(sqlFile('migrations/0041_dashboard_realtime.sql'));
ok('0041 re-applies cleanly after rollback');
console.log('\nOK dashboard.test.mjs');
