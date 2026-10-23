// Operator tool: rescans EXISTING business logos/banners through the scan Worker (migration 0058 + Worker route /v1/business-media/backfill).
// Nothing runs unless you ask for it, and nothing here deletes anything.
//
//   node scripts/business-media-backfill.js --expect-host <project>.supabase.co                     report only (read-only)   [default]
//   node scripts/business-media-backfill.js --expect-host <host> --inventory                         record every unscanned slot (bookkeeping rows only)
//   node scripts/business-media-backfill.js --expect-host <host> --scan [--limit 20]                 claim rows, rescan through the Worker, record the outcome
//   node scripts/business-media-backfill.js --expect-host <host> --apply --confirm-apply [--limit 20]  swap APPROVED rows to their scanned copy (compare-and-swap)
//   node scripts/business-media-backfill.js --expect-host <host> --requeue                           put escalated/unavailable rows back after fixing the cause
//
// Environment (never put these on the command line or in the repo):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   the project the rows live in
//   SCAN_URL, BACKFILL_SECRET                 the scan Worker and its operator secret (needed for --scan only)
//
// --expect-host is mandatory and must equal the host of SUPABASE_URL: it exists so a staging command can never hit production (or the
// reverse) because of a stale environment variable. Progress lines show only a short row id, never a user id, key or URL.
// Resumable: a crashed run leaves rows 'scanning' with a lease; the next --scan reclaims them after the lease expires.
// What happens to rejected / held / missing / unreadable images is an OWNER DECISION that has not been taken: they are reported, never changed.
'use strict';

const OUTCOME_TO_STATUS = { approved: 'approved', rejected: 'rejected', held: 'held', missing: 'missing', unreadable: 'unreadable', unavailable: 'unavailable' };

function parseArgs(argv) {
  const out = { mode: 'report', limit: 20, expectHost: null, confirmApply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--expect-host') out.expectHost = argv[++i] ?? null;
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--confirm-apply') out.confirmApply = true;
    else if (['--inventory', '--scan', '--apply', '--requeue', '--report'].includes(a)) out.mode = a.slice(2);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 200) throw new Error('--limit must be a whole number from 1 to 200');
  return out;
}

async function main(argv, env, fetchFn, log) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    log(String(e.message));
    return 2;
  }
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) { log('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'); return 2; }
  let host;
  try { host = new URL(base).host; } catch { log('SUPABASE_URL is not a valid URL.'); return 2; }
  if (!args.expectHost) { log('--expect-host <host> is required (it must match SUPABASE_URL so the wrong project is never touched).'); return 2; }
  if (args.expectHost !== host) { log(`Refusing to run: --expect-host does not match the SUPABASE_URL host (${args.expectHost} vs ${host}).`); return 2; }
  if (args.mode === 'apply' && !args.confirmApply) { log('--apply changes users\' profiles and storefronts. Add --confirm-apply to proceed.'); return 2; }
  if (args.mode === 'scan' && (!env.SCAN_URL || !/^https:\/\//.test(env.SCAN_URL) || !env.BACKFILL_SECRET)) { log('--scan needs SCAN_URL (https) and BACKFILL_SECRET.'); return 2; }

  const rpc = async (fn, body = {}) => {
    const res = await fetchFn(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`rpc ${fn} failed (${res.status})`);
    return res.json();
  };
  const short = (id) => String(id).slice(0, 8);

  try {
    if (args.mode === 'report') {
      const rows = await rpc('business_media_backfill_report');
      log(JSON.stringify({ mode: 'report', counts: Object.fromEntries(rows.map((r) => [r.status, Number(r.rows)])) }));
      return 0;
    }
    if (args.mode === 'inventory') {
      const [r] = await rpc('business_media_backfill_inventory');
      log(JSON.stringify({ mode: 'inventory', queued: r.queued, external: r.external }));
      return 0;
    }
    if (args.mode === 'requeue') {
      const a = await rpc('business_media_backfill_requeue', { p_status: 'escalated' });
      const b = await rpc('business_media_backfill_requeue', { p_status: 'unavailable' });
      log(JSON.stringify({ mode: 'requeue', escalated: a, unavailable: b }));
      return 0;
    }
    if (args.mode === 'scan') {
      const rows = await rpc('business_media_backfill_claim', { p_limit: args.limit });
      const tally = {};
      for (const row of rows) {
        let outcome = 'unavailable';
        let detail = null;
        try {
          const res = await fetchFn(`${env.SCAN_URL.replace(/\/$/, '')}/v1/business-media/backfill`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-backfill-secret': env.BACKFILL_SECRET },
            body: JSON.stringify({ ownerId: row.owner_id, kind: row.kind, originalKey: row.original_key }),
          });
          if (res.ok) detail = await res.json();
          else detail = { outcome: 'unavailable', error: `worker http ${res.status}` };
        } catch {
          detail = { outcome: 'unavailable', error: 'worker unreachable' };
        }
        outcome = OUTCOME_TO_STATUS[detail && detail.outcome] ?? 'unavailable';
        const approved = outcome === 'approved' && typeof detail.key === 'string' && typeof detail.url === 'string' && typeof detail.scanId === 'string';
        if (outcome === 'approved' && !approved) outcome = 'unavailable'; // an incomplete "approved" answer is never trusted
        try {
          await rpc('business_media_backfill_record', {
            p_id: row.id,
            p_status: outcome,
            p_scan_id: approved ? detail.scanId : null,
            p_new_key: approved ? detail.key : null,
            p_new_url: approved ? detail.url : null,
            p_error: outcome === 'approved' ? null : String((detail && detail.error) ?? outcome).slice(0, 200),
          });
        } catch {
          outcome = 'record_failed'; // the row keeps its lease and is retried after it expires; nothing was applied
        }
        tally[outcome] = (tally[outcome] ?? 0) + 1;
        log(`row ${short(row.id)} ${row.kind}: ${outcome}`);
      }
      log(JSON.stringify({ mode: 'scan', claimed: rows.length, outcomes: tally }));
      return 0;
    }
    if (args.mode === 'apply') {
      const res = await fetchFn(`${base}/rest/v1/business_media_backfill?status=eq.approved&select=id&order=created_at.asc&limit=${args.limit}`, {
        headers: { apikey: key, authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`list approved failed (${res.status})`);
      const rows = await res.json();
      const tally = {};
      for (const row of rows) {
        const r = await rpc('business_media_backfill_apply', { p_id: row.id });
        tally[r] = (tally[r] ?? 0) + 1;
        log(`row ${short(row.id)}: ${r}`);
      }
      log(JSON.stringify({ mode: 'apply', considered: rows.length, results: tally }));
      return 0;
    }
  } catch (e) {
    log(`Stopped: ${e.message}`);
    return 1;
  }
  return 2;
}

module.exports = { main, parseArgs };

if (require.main === module) {
  main(process.argv.slice(2), process.env, fetch, (m) => console.log(m)).then((code) => process.exit(code));
}
