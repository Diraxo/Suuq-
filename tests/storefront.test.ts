import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  StorefrontRow,
  validateStorefrontForm,
  toStorefrontPayload,
  storefrontActions,
  storefrontErrorKind,
  checkVerificationFile,
  verificationObjectPath,
  isOwnVerificationPath,
  storefrontImageFolder,
  formFromRow,
  VERIFICATION_MAX_BYTES,
} from '../lib/storefront';
import { isAllowedFolder } from '../supabase/functions/_shared/uploadPaths';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const UID = '11111111-1111-4111-8111-111111111111';

const row = (over: Partial<StorefrontRow> = {}): StorefrontRow => ({
  id: 's1', name: 'Shop', description: null, address: null, website: null, hours: {}, logo_url: null, banner_url: null,
  logo_public_id: null, banner_public_id: null, status: 'draft', verification_status: 'not_requested', published_at: null, verified_at: null, ...over,
});

test('web copy of the storefront rules is identical to the mobile original', () => {
  assert.equal(read('lib/storefront.ts'), read('web/src/lib/storefront.ts'));
});

test('form validation mirrors the table limits', () => {
  const ok = { name: 'Shop', description: 'd', address: 'a', website: 'https://x.example' };
  assert.deepEqual(validateStorefrontForm(ok), {});
  assert.deepEqual(validateStorefrontForm({ ...ok, name: '  ' }), {});
  assert.equal(validateStorefrontForm({ ...ok, name: '  ' }, { needName: true }).name, 'required');
  assert.equal(validateStorefrontForm({ ...ok, name: 'x'.repeat(151) }).name, 'tooLong');
  assert.equal(validateStorefrontForm({ ...ok, description: 'x'.repeat(2001) }).description, 'tooLong');
  assert.equal(validateStorefrontForm({ ...ok, address: 'x'.repeat(301) }).address, 'tooLong');
  assert.equal(validateStorefrontForm({ ...ok, website: 'ftp://x' }).website, 'badWebsite');
  assert.equal(validateStorefrontForm({ ...ok, website: 'https://a b' }).website, 'badWebsite');
  assert.equal(validateStorefrontForm({ ...ok, website: 'https://' + 'x'.repeat(300) }).website, 'tooLong');
  assert.equal(validateStorefrontForm({ ...ok, website: '' }).website, undefined);
});

test('the payload carries only owner-grantable columns and nulls blanks', () => {
  const p = toStorefrontPayload({ name: ' Shop ', description: '  ', address: '', website: ' https://x.example ' });
  assert.deepEqual(p, { name: 'Shop', description: null, address: null, website: 'https://x.example' });
  assert.deepEqual(Object.keys(p).sort(), ['address', 'description', 'name', 'website']);
  assert.deepEqual(formFromRow(null), { name: '', description: '', address: '', website: '' });
});

test('available actions follow the storefront lifecycle', () => {
  assert.equal(storefrontActions(null).canPublish, false);
  assert.equal(storefrontActions(null).canEdit, true);
  assert.equal(storefrontActions(row({ name: null })).canPublish, false);
  assert.equal(storefrontActions(row({ name: null })).canRequestVerification, false);
  const draft = storefrontActions(row());
  assert.deepEqual([draft.canPublish, draft.canUnpublish, draft.canRequestVerification], [true, false, true]);
  const pub = storefrontActions(row({ status: 'published' }));
  assert.deepEqual([pub.canPublish, pub.canUnpublish], [false, true]);
  const susp = storefrontActions(row({ status: 'suspended' }));
  assert.deepEqual([susp.canEdit, susp.canPublish, susp.canUnpublish, susp.canRequestVerification], [false, false, false, false]);
  const pending = storefrontActions(row({ verification_status: 'pending' }));
  assert.deepEqual([pending.identityLocked, pending.canRequestVerification], [true, false]);
  assert.equal(storefrontActions(row({ verification_status: 'rejected' })).canRequestVerification, true);
  const verified = storefrontActions(row({ verification_status: 'verified' }));
  assert.deepEqual([verified.editVoidsVerification, verified.canRequestVerification], [true, false]);
});

test('server errors map to stable kinds', () => {
  const k = storefrontErrorKind;
  assert.equal(k({ code: '42P01', message: 'relation "public.storefronts" does not exist' }), 'unavailable');
  assert.equal(k({ code: 'PGRST205' }), 'unavailable');
  assert.equal(k({ code: '42883' }), 'unavailable');
  assert.equal(k({ code: '55006', message: 'Business name and address are locked while verification is pending' }), 'identityLocked');
  assert.equal(k({ code: '23505', message: 'A verification request is already pending' }), 'alreadyRequested');
  assert.equal(k({ code: 'P0002', message: 'Create your storefront first' }), 'noStorefront');
  assert.equal(k({ code: 'P0002', message: 'Document not found' }), 'unknownDocument');
  assert.equal(k({ code: '42501', message: 'Not signed in' }), 'notSignedIn');
  assert.equal(k({ code: '42501', message: 'This storefront is suspended' }), 'suspended');
  assert.equal(k({ code: '23514', message: 'Invalid logo: it must be an image' }), 'invalidImage');
  assert.equal(k({ code: '23514', message: 'A storefront needs a name before it can be published' }), 'nameRequired');
  assert.equal(k({ code: '22023', message: 'Unknown document' }), 'unknownDocument');
  assert.equal(k({ code: '22023', message: 'Attach 1 to 5 documents' }), 'invalidInput');
  assert.equal(k({ message: 'Rate limit exceeded for "storefront_verification": try again later.' }), 'rateLimited');
  assert.equal(k({ code: 'XX000', message: 'boom' }), 'generic');
  assert.equal(k(null), 'generic');
});

test('verification files are pre-checked against the bucket limits', () => {
  assert.deepEqual(checkVerificationFile('image/jpeg', 100), { ok: true, ext: 'jpg' });
  assert.deepEqual(checkVerificationFile('application/pdf', VERIFICATION_MAX_BYTES), { ok: true, ext: 'pdf' });
  assert.deepEqual(checkVerificationFile('IMAGE/PNG', null), { ok: true, ext: 'png' });
  assert.deepEqual(checkVerificationFile('application/pdf', VERIFICATION_MAX_BYTES + 1), { ok: false, reason: 'size' });
  assert.deepEqual(checkVerificationFile('image/svg+xml', 10), { ok: false, reason: 'type' });
  assert.deepEqual(checkVerificationFile('text/html', 10), { ok: false, reason: 'type' });
  assert.deepEqual(checkVerificationFile(null, 10), { ok: false, reason: 'type' });
  assert.deepEqual(checkVerificationFile('image/jpeg', 0), { ok: false, reason: 'empty' });
});

test('document paths have exactly the shape Storage and the RPC accept', () => {
  const p = verificationObjectPath(UID, 'abc-123', 'pdf');
  assert.equal(p, `${UID}/abc-123.pdf`);
  assert.equal(isOwnVerificationPath(UID, p), true);
  assert.equal(isOwnVerificationPath(UID, `22222222-2222-4222-8222-222222222222/a.pdf`), false);
  assert.equal(isOwnVerificationPath(UID, `${UID}/sub/a.pdf`), false);
  assert.equal(isOwnVerificationPath(UID, `${UID}/a.svg`), false);
  assert.equal(isOwnVerificationPath(UID, `${UID}/a b.pdf`), false);
});

test('logo and banner folders are ones r2-presign accepts', () => {
  for (const kind of ['logo', 'banner'] as const) assert.equal(isAllowedFolder(storefrontImageFolder(UID, kind), UID), true);
  assert.equal(isAllowedFolder(storefrontImageFolder('22222222-2222-4222-8222-222222222222', 'logo'), UID), false);
});

test('both surfaces stay behind the storefront flag and use only the 0054 contract', () => {
  for (const f of ['app/business/storefront.tsx', 'web/src/app/business/storefront/page.tsx']) {
    const src = read(f);
    assert.ok(/STOREFRONTS_ENABLED/.test(src), `${f} must honour the flag`);
    for (const rpc of ['storefront_publish', 'storefront_unpublish', 'request_storefront_verification', 'my_storefront_verification']) {
      assert.ok(src.includes(rpc), `${f} should call ${rpc}`);
    }
    // status / verification columns are server-managed: a client write of them is refused by the guard trigger
    assert.ok(!/status:\s*['"](published|draft)/.test(src), `${f} must not write status directly`);
    assert.ok(!/from\(['"]profiles['"]\)\s*\.update/.test(src), `${f} must not write the derived profiles.business_* mirror`);
  }
});

test('opening hours display: 12 h times, today lookup and open-now', () => {
  const { formatTime12, isOpenNow, hoursDayOf, hoursLines } = require('../lib/storefront');
  assert.equal(formatTime12('00:05'), '12:05 AM');
  assert.equal(formatTime12('09:00'), '9:00 AM');
  assert.equal(formatTime12('12:00'), '12:00 PM');
  assert.equal(formatTime12('18:30'), '6:30 PM');
  const mon = new Date(2026, 9, 19, 10, 0); // Monday 19 Oct 2026, 10:00
  assert.equal(hoursDayOf(mon), 'mon');
  assert.equal(hoursDayOf(new Date(2026, 9, 25, 10, 0)), 'sun');
  const { days } = hoursLines({ days: { mon: { closed: false, open: '09:00', close: '17:00' }, tue: { closed: true } } });
  assert.equal(isOpenNow(days, mon), true);
  assert.equal(isOpenNow(days, new Date(2026, 9, 19, 17, 0)), false, 'closing time itself is closed');
  assert.equal(isOpenNow(days, new Date(2026, 9, 20, 10, 0)), false, 'closed day');
  assert.equal(isOpenNow(days, new Date(2026, 9, 21, 10, 0)), null, 'no entry for the day: unknown');
});
