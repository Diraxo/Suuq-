// Static parity checks between mobile and web for the photo pipeline. These read source files — they do NOT prove runtime
// behaviour (that is the pipeline tests, the database suites and the staging runbook). What they DO guard is drift: a
// copied rule edited on one side only, or a new route that writes listing photos without going through the shared gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_SCAN_COPY } from '../web/src/lib/imageScanCopy';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const en = JSON.parse(read('locales/en/translation.json')).imageScan;

test('web copies of the shared photo-pipeline modules are byte-identical to the originals', () => {
  for (const f of ['imageSafety.ts', 'imageScanState.ts', 'imageScanPolicy.ts', 'jpegMeta.ts', 'csv.ts', 'bulkImageQueue.ts', 'bulkQueueClient.ts', 'businessMedia.ts', 'saveOutcome.ts']) {
    assert.equal(read(`lib/${f}`), read(`web/src/lib/${f}`), `lib/${f} and web/src/lib/${f} have drifted — copy the original over the web copy`);
  }
});

test('web dialog wording is exactly the English mobile wording (imageScan.*)', () => {
  const picked = { checking: en.checking, result: en.result, errors: en.errors, issue: en.issue };
  assert.deepEqual(JSON.parse(JSON.stringify(IMAGE_SCAN_COPY)), picked, 'web/src/lib/imageScanCopy.ts is out of date — regenerate it from locales/en/translation.json');
});

test('every block reason the policy can produce has copy on mobile (en/so/am) and web', () => {
  for (const kind of ['update_required', 'not_verified', 'photo_rejected', 'policy_unavailable', 'offline', 'timeout', 'rate_limited', 'busy', 'unreadable', 'failed']) {
    for (const lng of ['en', 'so', 'am']) assert.ok(JSON.parse(read(`locales/${lng}/translation.json`)).imageScan.errors[kind], `${lng}: imageScan.errors.${kind}`);
    assert.ok((IMAGE_SCAN_COPY.errors as Record<string, string>)[kind], `web: errors.${kind}`);
  }
});

// ── every route that can put a photo on a listing goes through the shared decision first ────────────────────────
const before = (file: string, gate: string, upload: string) => {
  const src = read(file);
  const g = src.indexOf(gate);
  const u = src.indexOf(upload);
  assert.ok(g > 0, `${file}: missing ${gate}`);
  assert.ok(u > 0, `${file}: expected the legacy ${upload} fallback to exist`);
  assert.ok(g < u, `${file}: ${gate} must run before ${upload}`);
};

test('mobile create/edit and web create/edit ask the server policy BEFORE any legacy upload', () => {
  // preview.tsx defines the publish task (which holds the legacy upload) BEFORE the decision, so check its call sites instead:
  const preview = read('app/post/preview.tsx');
  const decide = preview.indexOf('decidePublishPath()');
  assert.ok(decide > 0 && preview.indexOf('uploadListingImages(') > 0);
  const starts = [...preview.matchAll(/runPublish\(null\)|proceedRef\.current = runPublish/g)].map((m) => m.index as number);
  assert.ok(starts.length >= 2 && starts.every((i) => i > decide), 'every start of the publish task must come after the server-policy decision');
  before('app/listing/edit/[id].tsx', 'decidePublishPath()', 'uploadListingImagesStrict(');
  before('web/src/app/sell/page.tsx', 'decidePublishPath()', 'uploadToR2(');
  before('web/src/app/listing/edit/[id]/page.tsx', 'decidePublishPath()', 'uploadToR2(');
});

test('no other source file uploads into the public listings/ folder or writes listing photos', () => {
  const skip = /node_modules|\.next|\.test-build|^docs|^supabase|^workers|^tests|^scripts/;
  const walk = (dir: string, out: string[] = []) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`.replace(/^\.\//, '');
      if (skip.test(rel)) continue;
      if (e.isDirectory()) walk(rel, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
    }
    return out;
  };
  const files = ['app', 'lib', 'components', 'hooks', 'store', 'web/src'].flatMap((d) => walk(d));
  const uploaders = files.filter((f) => /`listings\/\$\{/.test(read(f)) || /['"]listings\//.test(read(f))).sort();
  assert.deepEqual(
    uploaders,
    ['lib/storage.ts', 'web/src/app/listing/edit/[id]/page.tsx', 'web/src/app/sell/page.tsx'],
    'a new file builds a listings/ upload folder — route it through the scan decision (and add it here deliberately)',
  );
  const writers = files.filter((f) => /from\('listings'\)\s*\.\s*(insert|upsert|update)\(/.test(read(f)) || /supabase\s*\.from\('listings'\)\s*\.(insert|upsert|update)/.test(read(f))).sort();
  // store/myListings.ts + web/src/services/listings.ts are the two gateways (create/edit); everything else is audited by hand.
  assert.deepEqual(
    writers.filter((f) => !/^web\/src\/services\/admin/.test(f)),
    // bulk-upload.tsx: legacy direct insert, only reachable while the server is NOT enforcing (chooseBulkPath);
    // BulkQueuePanel.tsx: publishes queued rows with the server's watermarked derivative URLs through the trigger-guarded write.
    ['app/business/bulk-upload.tsx', 'components/BulkQueuePanel.tsx', 'store/myListings.ts', 'web/src/services/listings.ts'],
    'a new file writes to the listings table — it must not be able to add photos without the scan gate',
  );
});

test('public image URLs only ever come from the public bucket: no client code reads the private original or held copy', () => {
  const webAdmin = /^web\/src\/(services\/adminScans|components\/PhotoChecksCard)\.tsx?$/;
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (/node_modules|\.next/.test(rel)) continue;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name) && !webAdmin.test(rel) && /['"`](orig|pending)\//.test(read(rel))) hits.push(rel);
    }
  };
  for (const d of ['app', 'lib', 'components', 'hooks', 'store', 'web/src']) walk(d);
  assert.deepEqual(hits, [], 'client code references the private orig/ or pending/ namespace');
});
