import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationHref } from '../web/src/lib/notificationRoute';

const U = '3f2b8c6e-1d4a-4b7e-9c10-2a5d6e7f8091';

test('verification and moderation notifications open the screens that explain them', () => {
  assert.equal(notificationHref('verification', { kind: 'verified', eventId: U }), '/profile');
  assert.equal(notificationHref('moderation', { kind: 'warning', eventId: U, noticeId: U }), '/support');
  assert.equal(notificationHref('support_reply', { caseId: U }), `/support/${U}`);
  assert.equal(notificationHref('support_reply', {}), '/support');
});

test('report outcomes stay on the list; staff report alerts open the workspace', () => {
  assert.equal(notificationHref('report_result', { reportId: U, status: 'dismissed' }), null);
  assert.equal(notificationHref('report_staff', { reportId: U }), `/admin/reports/${U}`);
  assert.equal(notificationHref('report_staff', {}), '/admin/reports');
});

test('ids that are not uuids can never become part of a route', () => {
  assert.equal(notificationHref('favorite', { listingId: '../../admin' }), null);
  assert.equal(notificationHref('report_staff', { reportId: 'x/../../admin/users' }), '/admin/reports');
  assert.equal(notificationHref('message', { conversationId: 'javascript:alert(1)' }), '/chat');
  assert.equal(notificationHref('offer_new', { listingId: { a: 1 } }), '/offers');
  assert.equal(notificationHref('favorite', { listingId: U }), `/listing/${U}`);
});

test('unknown, legacy and missing types have no destination', () => {
  assert.equal(notificationHref(null, null), null);
  assert.equal(notificationHref('something_new', { listingId: U }), null);
});

test('activity alerts open the user they are about, or the users list', () => {
  assert.equal(notificationHref('activity_staff', { userId: U }), `/admin/users/${U}`);
  assert.equal(notificationHref('activity_staff', {}), '/admin/users');
  assert.equal(notificationHref('activity_staff', { userId: '../x' }), '/admin/users');
});
