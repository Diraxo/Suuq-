import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ReviewDetail,
  adminErrorMessage,
  documentLabel,
  documentOpenMessage,
  identityChanged,
  parseSignedUrl,
  reasonOk,
  reviewActions,
} from '../web/src/lib/storefrontAdmin';
import { adminGate, routePermission, STAFF_CAN } from '../web/src/lib/adminGate';
import { notificationHref } from '../web/src/lib/notificationRoute';
import { PUBLIC_STOREFRONT_COLUMNS, STOREFRONT_COLUMNS, hoursLines, isStorefrontId, safeWebsiteHref } from '../lib/storefront';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const SQL = read('supabase/migrations/0054_storefronts.sql');
const U = '3f2b8c6e-1d4a-4b7e-9c10-2a5d6e7f8091';

const detail = (over: Partial<ReviewDetail> = {}, sf: Partial<ReviewDetail['storefront']> = {}): ReviewDetail => ({
  requestId: U, status: 'pending', documentPaths: [`${U}/a.pdf`, `${U}/b.jpg`], ownerNote: null, submittedAt: '2026-10-18T00:00:00Z',
  submittedName: 'Shop', submittedAddress: 'Hargeisa', decisionReason: null, reviewedBy: null, reviewedAt: null,
  storefront: { id: 's1', ownerId: U, name: 'Shop', description: null, address: 'Hargeisa', website: null, status: 'draft', verificationStatus: 'pending', ...sf },
  ...over,
});

test('reason rule matches the RPCs (10+ characters after trimming)', () => {
  assert.equal(reasonOk('too short'), false);
  assert.equal(reasonOk('   123456789   '), false);
  assert.equal(reasonOk('1234567890'), true);
});

test('approve is offered only when the RPC would accept it', () => {
  assert.deepEqual(reviewActions(detail()), { approve: true, reject: true, revoke: false, suspend: true, reinstate: false, approveBlockedBy: null });
  const renamed = reviewActions(detail({}, { name: 'Other Shop' }));
  assert.deepEqual([renamed.approve, renamed.reject, renamed.approveBlockedBy], [false, true, 'identityChanged']);
  assert.equal(reviewActions(detail({}, { address: 'Berbera' })).approveBlockedBy, 'identityChanged');
  const susp = reviewActions(detail({}, { status: 'suspended' }));
  assert.deepEqual([susp.approve, susp.reject, susp.suspend, susp.reinstate, susp.approveBlockedBy], [false, true, false, true, 'suspended']);
  const decided = reviewActions(detail({ status: 'approved' }, { verificationStatus: 'verified' }));
  assert.deepEqual([decided.approve, decided.reject, decided.revoke], [false, false, true]);
  assert.equal(identityChanged(detail({ submittedAddress: null }, { address: null })), false);
});

test('staff refusals become plain language, never raw database text', () => {
  const m = adminErrorMessage;
  assert.match(m({ code: '42501', message: 'Not authorized' }), /permission/);
  assert.match(m({ code: '42501', message: 'You cannot review your own storefront' }), /own storefront/);
  assert.match(m({ code: '22023', message: 'A reason of at least 10 characters is required' }), /10 characters/);
  assert.match(m({ code: '23505', message: 'This request was already decided' }), /already decided/);
  assert.match(m({ code: '23514', message: 'The business identity changed after submission; ask the owner to resubmit' }), /resubmit/i);
  assert.match(m({ code: '23514', message: 'Reinstate the suspended storefront first' }), /Reinstate/);
  assert.match(m({ code: 'P0002', message: 'Request not found' }), /no longer exists/);
  assert.match(m({ code: 'PGRST202' }), /isn’t available/);
  assert.doesNotMatch(m({ code: 'XX000', message: 'relation "x" violates secret detail' }), /secret|relation/);
});

test('document responses: only a real https signed URL opens; failures say nothing about the document', () => {
  const ok = 'https://x.supabase.co/storage/v1/object/sign/b/p?token=t';
  assert.deepEqual(parseSignedUrl({ signedUrl: ok, expiresInSeconds: 120 }), { url: ok, expiresInSeconds: 120 });
  assert.equal(parseSignedUrl({ signedUrl: 'javascript:alert(1)' }), null);
  assert.equal(parseSignedUrl({ signedUrl: 'http://evil.example/x' }), null);
  assert.equal(parseSignedUrl({ signedUrl: 'not a url' }), null);
  assert.equal(parseSignedUrl({}), null);
  assert.equal(parseSignedUrl(null), null);
  assert.match(documentOpenMessage(401), /expired/);
  assert.match(documentOpenMessage(403), /permission/);
  assert.match(documentOpenMessage(404), /couldn’t be found/);
  assert.match(documentOpenMessage(502), /Nothing was shown/);
  assert.equal(documentLabel(`${U}/abc-def.pdf`, 0), 'Document 1 (PDF)');
});

test('/admin/businesses is admin-only: moderator and support are not allowed in', () => {
  assert.equal(routePermission('/admin/businesses'), 'business_review');
  assert.equal(STAFF_CAN.admin.has('business_review'), true);
  assert.equal(STAFF_CAN.moderator.has('business_review'), false);
  assert.equal(STAFF_CAN.support.has('business_review'), false);
  const base = { initializing: false, hasSession: true, roleChecked: true };
  assert.equal(adminGate({ ...base, role: 'admin', pathname: '/admin/businesses' }), 'allow');
  assert.equal(adminGate({ ...base, role: 'moderator', pathname: '/admin/businesses' }), 'not-found');
  assert.equal(adminGate({ ...base, role: 'support', pathname: '/admin/businesses' }), 'not-found');
  assert.equal(adminGate({ ...base, role: null, pathname: '/admin/businesses' }), 'not-found');
});

test('storefront notifications open the owner screen', () => {
  assert.equal(notificationHref('storefront', { kind: 'verification_approve' }), '/business/storefront');
});

test('public hours are read defensively and never depend on the device locale', () => {
  const h = hoursLines({ days: { mon: { closed: false, open: '09:00', close: '18:00' }, tue: { closed: true, open: '09:00', close: '18:00' }, wed: { open: '25:00', close: '18:00' }, thu: 'x', sun: { closed: false, open: '10:00', close: '14:30' } } });
  assert.deepEqual(h.days.map((d) => [d.day, d.closed, d.open, d.close]), [['mon', false, '09:00', '18:00'], ['tue', true, null, null], ['sun', false, '10:00', '14:30']]);
  assert.deepEqual(hoursLines({}), { days: [], note: null });
  assert.deepEqual(hoursLines(null), { days: [], note: null });
  assert.deepEqual(hoursLines('mon'), { days: [], note: null });
  assert.equal(hoursLines({ note: '  Mon-Fri 9-5  ' }).note, 'Mon-Fri 9-5');
  assert.equal(hoursLines({ note: 'x'.repeat(500) }).note?.length, 300);
});

test('only plain http(s) links and uuids are ever used', () => {
  assert.equal(safeWebsiteHref('https://shop.example/a?b=1'), 'https://shop.example/a?b=1');
  assert.equal(safeWebsiteHref(' http://shop.example '), 'http://shop.example/');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'intent://x', 'ftp://x', 'https://a b', '', null, undefined]) assert.equal(safeWebsiteHref(bad as string | null), null);
  assert.equal(isStorefrontId(U), true);
  for (const bad of ['', '../admin', `${U}/x`, 'undefined', 123, null]) assert.equal(isStorefrontId(bad), false);
});

// ---- the clients stay inside the real 0054 contract (these read the migration text, so a rename there fails here) ----

function viewColumns(): string[] {
  const m = /create view public\.public_storefronts[\s\S]*?select([\s\S]*?)from public\.storefronts s/i.exec(SQL);
  assert.ok(m, 'public_storefronts view not found in 0054');
  return m![1].split(',').map((c) => c.trim()).filter(Boolean).map((c) => /\sas\s+(\w+)$/i.exec(c)?.[1] ?? c.replace(/^s\./, ''));
}
function tableColumns(): string[] {
  const body = /create table public\.storefronts \(([\s\S]*?)\n\);/.exec(SQL)![1];
  return body.split('\n').map((l) => /^ {2}(\w+) (uuid|text|jsonb|timestamptz)/.exec(l)?.[1]).filter(Boolean) as string[];
}

test('the public read selects exactly columns the public view exposes', () => {
  const exposed = new Set(viewColumns());
  const wanted = PUBLIC_STOREFRONT_COLUMNS.split(',').map((c) => c.trim());
  for (const c of wanted) assert.ok(exposed.has(c), `public_storefronts does not expose ${c}`);
  for (const c of ['status', 'verification_status', 'suspended_at', 'status_before_suspension', 'logo_public_id']) assert.ok(!wanted.includes(c), `${c} must not be read publicly`);
});

test('the owner read selects only real table columns', () => {
  const cols = new Set(tableColumns());
  for (const c of STOREFRONT_COLUMNS.split(',').map((x) => x.trim())) assert.ok(cols.has(c), `storefronts has no column ${c}`);
});

test('every RPC and argument the clients call exists in 0054', () => {
  const calls: [string, string[]][] = [
    ['admin_list_storefront_reviews', ['p_status', 'p_limit', 'p_offset']],
    ['admin_get_storefront_review', ['p_request']],
    ['admin_decide_storefront_verification', ['p_request', 'p_decision', 'p_reason', 'p_message']],
    ['admin_revoke_storefront_verification', ['p_storefront', 'p_reason', 'p_message']],
    ['admin_set_storefront_status', ['p_storefront', 'p_action', 'p_reason', 'p_message']],
    ['request_storefront_verification', ['p_document_paths', 'p_note']],
    ['storefront_publish', []],
    ['storefront_unpublish', []],
    ['my_storefront_verification', []],
  ];
  const clients = read('web/src/services/storefrontAdmin.ts') + read('app/business/storefront.tsx') + read('web/src/app/business/storefront/page.tsx');
  for (const [fn, args] of calls) {
    const def = new RegExp(`function public\\.${fn}\\(([^)]*)\\)`).exec(SQL);
    assert.ok(def, `${fn} not defined in 0054`);
    for (const a of args) assert.ok(def![1].includes(a), `${fn} has no argument ${a}`);
    assert.ok(clients.includes(`'${fn}'`), `${fn} is not called by any client`);
    for (const a of args) assert.ok(clients.includes(a), `clients never pass ${a}`);
  }
  assert.ok(read('web/src/services/storefrontAdmin.ts').includes("'verification-document'"));
  assert.match(read('web/src/services/storefrontAdmin.ts'), /requestId, path/);
});

test('public and admin surfaces: flagged, read only the public view, never touch protected fields or Storage', () => {
  for (const f of ['app/storefront/[id].tsx', 'web/src/app/storefront/[id]/page.tsx']) {
    const src = read(f);
    assert.ok(/STOREFRONTS_ENABLED/.test(src), `${f} must honour the flag`);
    assert.ok(src.includes("from('public_storefronts')"), `${f} must read the public view`);
    assert.ok(!src.includes("from('storefronts')"), `${f} must not read the private table`);
    assert.ok(!/\.(insert|update|upsert|delete)\(/.test(src), `${f} must be read-only`);
    assert.ok(!/logo_public_id|banner_public_id|verification_status|\.storage\b/.test(src), `${f} must not touch private fields or Storage`);
    assert.ok(/safeWebsiteHref/.test(src) && /isStorefrontId/.test(src), `${f} must validate the id and the website link`);
  }
  const page = read('web/src/app/admin/businesses/page.tsx');
  const adminSrc = page + read('web/src/services/storefrontAdmin.ts');
  assert.ok(/STOREFRONTS_ENABLED/.test(page));
  assert.ok(!/\.storage\b|createSignedUrl/.test(adminSrc), 'staff must reach documents only through the audited function');
  assert.ok(!/from\(['"](storefronts|storefront_verification_requests|profiles)['"]\)/.test(adminSrc), 'admin writes go through the RPCs only');
  assert.ok(/STOREFRONTS_ENABLED/.test(read('web/src/app/admin/layout.tsx')));
});

test('both flags default to off', () => {
  for (const f of ['lib/storefrontFlag.ts', 'web/src/lib/storefrontFlag.ts']) {
    const src = read(f);
    assert.match(src, /=== 'true'/);
    assert.ok(!src.includes('?? true'));
  }
});

test('the dashboards and seller profiles link to storefronts only behind the flag', () => {
  for (const f of ['app/business/dashboard.tsx', 'web/src/app/business/dashboard/page.tsx']) assert.match(read(f), /STOREFRONTS_ENABLED \?/);
  assert.match(read('hooks/usePublicStorefrontId.ts'), /if \(!STOREFRONTS_ENABLED/);
  // The web seller page reads the storefront (and its verified flag) only through this hook, which returns null while the flag is off.
  assert.match(read('web/src/hooks/usePublicStorefront.ts'), /if \(!STOREFRONTS_ENABLED/);
  assert.match(read('web/src/hooks/usePublicStorefront.ts'), /STOREFRONTS_ENABLED && found/);
  assert.match(read('web/src/app/seller/[id]/page.tsx'), /usePublicStorefront\(id\)/);
  assert.doesNotMatch(read('web/src/app/seller/[id]/page.tsx'), /from\('public_storefronts'\)/);
});
