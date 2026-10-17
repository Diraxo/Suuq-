// Runs every database test suite in order, each in its own process (each boots a fresh in-memory Postgres and
// applies the real migration chain).
//
//   1. mkdir <scratch>; cd <scratch>; npm init -y; npm i @electric-sql/pglite
//   2. PGLITE_DIR=<scratch>/node_modules/@electric-sql/pglite node supabase/tests/run-all.mjs
//
// homefeed.test.mjs also needs the compiled TypeScript: run `npm test` once first (it builds .test-build).
// Needs Node >= 22.18 (runs the shared .ts modules natively). Nothing here touches a real database.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

if (!process.env.PGLITE_DIR) {
  console.error('Set PGLITE_DIR to the folder containing node_modules/@electric-sql/pglite (see header).');
  process.exit(2);
}
const suites = ['baseline', 'discovery', 'moderation', 'support', 'dashboard', 'homefeed', 'listings_reads', 'block_enforcement', 'chat_blocking', 'report_notify', 'report_workspace', 'image_scans', 'image_scan_modes', 'bulk_queue', 'staff_alerts'];
let failed = 0;
for (const s of suites) {
  const file = path.join(import.meta.dirname, `${s}.test.mjs`);
  console.log(`\n=== ${s} ===`);
  const r = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', file], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) {
    failed++;
    console.error(`FAILED: ${s}`);
  }
}
console.log(failed === 0 ? `\nALL ${suites.length} DATABASE SUITES PASSED` : `\n${failed} SUITE(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
