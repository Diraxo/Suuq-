import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { adminGate } from '../web/src/lib/adminGate';

const base = { initializing: false, hasSession: true, roleChecked: true, role: null as string | null };

test('signed-out visitor gets not-found (same outcome as an unknown route)', () => {
  assert.equal(adminGate({ ...base, hasSession: false, roleChecked: true }), 'not-found');
});
test('ordinary signed-in user (no staff role) gets not-found', () => {
  assert.equal(adminGate({ ...base, role: null }), 'not-found');
});
test('failed role lookup fails closed to not-found', () => {
  // getStaffRole() returns null on any RPC error
  assert.equal(adminGate({ ...base, role: null }), 'not-found');
});
test('nothing renders while auth or the role lookup is in flight', () => {
  assert.equal(adminGate({ ...base, initializing: true }), 'pending');
  assert.equal(adminGate({ ...base, roleChecked: false }), 'pending');
  assert.equal(adminGate({ ...base, roleChecked: false, role: 'admin' }), 'pending');
});
test('a role is only honoured once checked for the current user', () => {
  assert.equal(adminGate({ ...base, roleChecked: false, role: 'admin' }), 'pending');
});
for (const role of ['admin', 'moderator', 'support']) {
  test(`database-confirmed ${role} is allowed`, () => {
    assert.equal(adminGate({ ...base, role }), 'allow');
  });
}

const web = path.join(__dirname, '..', '..', 'web', 'src');
const layout = fs.readFileSync(path.join(web, 'app', 'admin', 'layout.tsx'), 'utf8');

test('admin layout reveals no admin wording to unauthorized visitors', () => {
  assert.doesNotMatch(layout, /doesn't have admin access/i);
  assert.doesNotMatch(layout, /Not authorized/);
  assert.doesNotMatch(layout, /Admin sign-in required/);
  assert.doesNotMatch(layout, /signInWithGoogle/);
});
test('admin layout calls notFound() before it ever renders children', () => {
  const nf = layout.indexOf('notFound();');
  const children = layout.indexOf('{children}');
  assert.ok(nf > 0 && children > nf, 'notFound() must precede {children}');
  assert.equal(layout.match(/\{children\}/g)?.length, 1);
});
test('a generic app-level 404 exists and has no admin-specific route', () => {
  assert.ok(fs.existsSync(path.join(web, 'app', 'not-found.tsx')));
  assert.ok(!fs.existsSync(path.join(web, 'app', 'admin', 'not-found.tsx')));
  assert.doesNotMatch(fs.readFileSync(path.join(web, 'app', 'not-found.tsx'), 'utf8'), /admin/i);
});
test('no server actions or API routes bypass the database authorization', () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(web);
  assert.deepEqual(files.filter((f) => /[\/]route\.(ts|js)$/.test(f)), []);
  assert.deepEqual(files.filter((f) => /\.(ts|tsx)$/.test(f) && /['"]use server['"]/.test(fs.readFileSync(f, 'utf8'))), []);
});
test('every admin RPC/query in services/admin.ts goes through the user-scoped client (RLS / staff_can)', () => {
  const svc = fs.readFileSync(path.join(web, 'services', 'admin.ts'), 'utf8');
  assert.doesNotMatch(svc, /service_role|SERVICE_ROLE/);
  assert.match(svc, /supabase\.rpc\('staff_role'\)/);
});

import { routePermission, STAFF_CAN, isStaffRole } from '../web/src/lib/adminGate';

test('each role only reaches the sections its permissions cover', () => {
  const at = (role: string, pathname: string) => adminGate({ ...base, role, pathname });
  // support: overview, listings (read) and support only
  assert.equal(at('support', '/admin'), 'allow');
  assert.equal(at('support', '/admin/support/abc'), 'allow');
  for (const p of ['/admin/reports', '/admin/users/x', '/admin/locations', '/admin/history']) assert.equal(at('support', p), 'not-found', p);
  // moderator: no locations / audit history
  assert.equal(at('moderator', '/admin/reports/1'), 'allow');
  assert.equal(at('moderator', '/admin/users'), 'allow');
  for (const p of ['/admin/locations', '/admin/history']) assert.equal(at('moderator', p), 'not-found', p);
  // admin: everything
  for (const p of ['/admin', '/admin/reports', '/admin/listings', '/admin/users', '/admin/support', '/admin/locations', '/admin/history']) assert.equal(at('admin', p), 'allow', p);
});
test('unknown /admin sub-paths are a 404 even for admins', () => {
  assert.equal(routePermission('/admin/secret-thing'), null);
  assert.equal(adminGate({ ...base, role: 'admin', pathname: '/admin/secret-thing' }), 'not-found');
  assert.equal(routePermission('/administrator'), null);
});
test('forged or unexpected role values never pass', () => {
  for (const bad of ['Admin', 'root', 'true', '', 'admin ', 'superadmin', 'owner']) {
    assert.equal(isStaffRole(bad), false, bad);
    assert.equal(adminGate({ ...base, role: bad, pathname: '/admin' }), 'not-found', bad);
  }
});
test('admin-only actions are never granted to moderators or support', () => {
  for (const a of ['ban', 'verify', 'boost', 'locations', 'audit']) {
    assert.ok(STAFF_CAN.admin.has(a));
    assert.ok(!STAFF_CAN.moderator.has(a) && !STAFF_CAN.support.has(a), a);
  }
});
test('permission matrix matches staff_can() in migration 0039', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0039_moderation_enforcement.sql'), 'utf8');
  const grab = (role: string) => {
    const m = sql.match(new RegExp(`when '${role}' then p_action in \(([^)]*)\)`));
    assert.ok(m, role);
    return new Set(m[1].replace(/[()]/g, '').split(',').map((x) => x.trim().replace(/'/g, '')));
  };
  for (const role of ['moderator', 'support'] as const) {
    const dbSet = grab(role);
    for (const a of STAFF_CAN[role]) assert.ok(dbSet.has(a), `${role} UI grants '${a}' that the database does not`);
  }
});
