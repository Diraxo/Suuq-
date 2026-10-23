// Block / report entry points: the chat header, the listing seller card and the profile page all open the same safety
// sheet, listing and user reports are separate categories, and a report from a chat is tagged with its context.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');

test('chat header: profile is tappable and a three-dots menu opens the safety sheet with report + block', () => {
  const chat = read('app', 'chat', '[id].tsx');
  assert.match(chat, /router\.push\(`\/seller\/\$\{resolved\.withUser\.id\}`/, 'avatar/name open the profile');
  assert.match(chat, /ellipsis-vertical/);
  assert.match(chat, /<UserSafetySheet[\s\S]*source="chat"/);
  assert.match(chat, /conversationId=\{resolved\.id\}/);
  assert.match(chat, /blockedByMe \? \(/, 'a chat I blocked swaps the composer for the blocked banner');
  assert.match(chat, /common\.unblock/, 'the banner offers Unblock');
});

test('listing detail and profile page expose the same menu; owners do not get it on their own listing', () => {
  const listing = read('app', 'listing', '[id].tsx');
  assert.match(listing, /<UserSafetySheet[\s\S]*source="listing"/);
  assert.match(listing, /!isOwner && \(\s*<Pressable[\s\S]*safety\.menuLabel/);
  const seller = read('app', 'seller', '[id].tsx');
  assert.match(seller, /<UserSafetySheet[\s\S]*source="profile"/);
  assert.match(seller, /!isSelf && \(/);
});

test('sheet: view profile, report listing, report user, block/unblock; listing and user are separate report types', () => {
  const sheet = read('components', 'UserSafetySheet.tsx');
  for (const k of ['safety.viewProfile', 'safety.reportListing', 'safety.reportUser', 'safety.blockUser', 'safety.unblockUser']) assert.match(sheet, new RegExp(k.replace('.', '\\.')), k);
  assert.match(sheet, /reportParams\('listing', listingId\)/);
  assert.match(sheet, /reportParams\('user', userId\)/);
  assert.match(sheet, /\.block\(userId\)/);
  assert.match(sheet, /\.unblock\(userId\)/);
});

test('report screen: chat-specific user reasons and a context tag; reasons exist in every language', () => {
  const rep = read('app', 'report', 'index.tsx');
  assert.match(rep, /CHAT_USER_REASON_KEYS/);
  assert.match(rep, /\[From \$\{source\}/);
  assert.match(rep, /slice\(0, 1000\)/, 'stays inside the 1000-character details limit');
  for (const l of ['en', 'so', 'am']) {
    const d = JSON.parse(read('locales', l, 'translation.json'));
    for (const k of ['offPlatformPayment', 'inappropriateContent']) assert.ok(d.report.reasons[k], `${l} report.reasons.${k}`);
    for (const k of ['menuLabel', 'title', 'viewProfile', 'viewProfileOf', 'reportListing', 'reportUser', 'blockUser', 'unblockUser', 'blockHint']) assert.ok(d.safety[k], `${l} safety.${k}`);
    assert.ok(d.report.fromChatNote, `${l} fromChatNote`);
  }
});

test('0045: a new report notifies admins and moderators without exposing the reporter', () => {
  const sql = read('supabase', 'migrations', '0045_report_notifies_staff.sql');
  assert.match(sql, /after insert on public\.reports/);
  assert.match(sql, /a\.role in \('admin', 'moderator'\)/);
  assert.match(sql, /exception when others then/);
  assert.doesNotMatch(sql, /reporter_id'/, 'reporter id is not placed in the notification data');
  assert.ok(fs.existsSync(path.join(root, 'supabase', 'rollback', '0045_report_notifies_staff_ROLLBACK.sql')));
});

test('nobody can block or report themselves, in the app or on the website', () => {
  const sheet = read('components', 'UserSafetySheet.tsx');
  assert.match(sheet, /meId === userId\) return null/);
  assert.match(read('app', 'seller', '[id].tsx'), /\{!isSelf && \(\s*<Pressable/, 'no menu on your own profile');
  assert.match(read('app', 'listing', '[id].tsx'), /\{!isOwner && \(\s*<Pressable\s+onPress=\{\(\) => requireAuth\(\(\) => router\.push\(`\/report\?type=listing/, 'no "Report this listing" on your own listing');
  assert.match(read('web', 'src', 'app', 'listing', '[id]', 'page.tsx'), /\{!viewerIsOwner && \(\s*<button/);
  for (const f of [['store', 'blockedUsers.ts'], ['web', 'src', 'store', 'blockedUsers.ts']]) assert.match(read(...f), /uid === userId\) return/, f.join('/'));
  assert.match(read('store', 'reports.ts'), /targetId === session\.user\.id/);
  assert.match(read('web', 'src', 'services', 'reports.ts'), /targetId === reporterId/);
});

test('website: the profile page exists and the listing seller card and chat header link to it, with the same safety menu', () => {
  assert.ok(fs.existsSync(path.join(root, 'web', 'src', 'app', 'seller', '[id]', 'page.tsx')));
  const page = read('web', 'src', 'app', 'seller', '[id]', 'page.tsx');
  assert.match(page, /listSellerListings/);
  assert.match(page, /<UserSafetyMenu[\s\S]*source="profile"/);
  const listing = read('web', 'src', 'app', 'listing', '[id]', 'page.tsx');
  assert.match(listing, /href=\{`\/seller\/\$\{listing\.seller\.id\}`\}/);
  assert.match(listing, /!viewerIsOwner && \(\s*<Card className="mt-5[\s\S]*<UserSafetyMenu/);
  const chat = read('web', 'src', 'app', 'chat', '[id]', 'page.tsx');
  assert.match(chat, /href=\{`\/seller\/\$\{conversation\.withUser\.id\}`\}/);
  assert.match(chat, /<UserSafetyMenu[\s\S]*source="chat"/);
  const menu = read('web', 'src', 'components', 'UserSafetyMenu.tsx');
  assert.match(menu, /meId === userId\) return null/);
  assert.match(read('web', 'src', 'services', 'listings.ts'), /rpc\('seller_listings'/);
});
