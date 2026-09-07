/**
 * Integration tests against a real (temporary, isolated) SQLite database and
 * a real running instance of the Express app. Run with: npm test
 *
 * These intentionally exercise the same guarantees documented in the test
 * matrix (docs/README-internal.md): authentication, RBAC denial, tenant
 * isolation, and subscription enforcement — not just happy paths.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDb = path.join(os.tmpdir(), `sma-test-${Date.now()}.db`);
process.env.SQLITE_FILE = tmpDb;
process.env.SESSION_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@test.local';
process.env.BOOTSTRAP_ADMIN_PASSWORD = 'BootstrapPass!123';
process.env.TRIAL_LENGTH_DAYS = '30';

require('../db/migrate');
const seedLib = require('./seedForTests');

let app;
let server;
let baseUrl;

test.before(async () => {
  await seedLib.seedTestData();
  app = require('../app');
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => {
  server.close();
  fs.rmSync(tmpDb, { force: true });
  fs.rmSync(`${tmpDb}-wal`, { force: true });
  fs.rmSync(`${tmpDb}-shm`, { force: true });
});

function extractCookie(res) {
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(';')[0] : null;
}

async function login(login_, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: login_, password }),
  });
  const cookie = extractCookie(res);
  const body = await res.json();
  return { status: res.status, cookie, body };
}

test('login fails with wrong credentials without revealing which field was wrong', async () => {
  const { status, body } = await login('sed@testschool-a.demo', 'WrongPassword!1');
  assert.equal(status, 401);
  assert.match(body.error, /incorrect/i);
});

test('SED can log in and read their own dashboard including profit', async () => {
  const { status, cookie, body } = await login('sed@testschool-a.demo', 'TestPass!2026');
  assert.equal(status, 200);
  assert.ok(body.school);
  const dash = await fetch(`${baseUrl}/api/dashboard/sed`, { headers: { Cookie: cookie } });
  assert.equal(dash.status, 200);
  const dashBody = await dash.json();
  assert.ok('profit' in dashBody);
});

test('Head Teacher is denied the SED profit dashboard', async () => {
  const { cookie } = await login('headteacher@testschool-a.demo', 'TestPass!2026');
  const res = await fetch(`${baseUrl}/api/dashboard/sed`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 403);
});

test('Accountant is denied creating an infrastructure project', async () => {
  const { cookie } = await login('accountant@testschool-a.demo', 'TestPass!2026');
  const res = await fetch(`${baseUrl}/api/school/infrastructure-projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'New library', budget: 5000 }),
  });
  assert.equal(res.status, 403);
});

test('Accountant CAN record a payment (has payments.manage)', async () => {
  const { cookie } = await login('accountant@testschool-a.demo', 'TestPass!2026');
  const feesRes = await fetch(`${baseUrl}/api/school/fees`, { headers: { Cookie: cookie } });
  const fees = (await feesRes.json()).data;
  assert.ok(fees.length > 0, 'test fixture should have at least one fee record');
  const res = await fetch(`${baseUrl}/api/school/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ feeId: fees[0].public_id, amount: 1000, method: 'cash' }),
  });
  assert.equal(res.status, 201);
});

test('a school user can never reach platform admin routes', async () => {
  const { cookie } = await login('sed@testschool-a.demo', 'TestPass!2026');
  const res = await fetch(`${baseUrl}/api/admin/schools`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 403);
});

test('Platform Admin cannot see school financial figures via the admin API', async () => {
  const { cookie } = await login('admin@test.local', 'BootstrapPass!123');
  const res = await fetch(`${baseUrl}/api/admin/schools`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes('revenue') && !serialized.includes('profit'));
});

test('tenant isolation: School B user gets different data than School A, and cannot address School A resources', async () => {
  const a = await login('accountant@testschool-a.demo', 'TestPass!2026');
  const b = await login('accountant@testschool-b.demo', 'TestPass!2026');

  const aStudents = await (await fetch(`${baseUrl}/api/school/students`, { headers: { Cookie: a.cookie } })).json();
  const bStudents = await (await fetch(`${baseUrl}/api/school/students`, { headers: { Cookie: b.cookie } })).json();
  assert.notEqual(aStudents.data[0].admission_no, bStudents.data[0].admission_no);

  // School B tries to record a payment against a fee that belongs to School A.
  const aFees = await (await fetch(`${baseUrl}/api/school/fees`, { headers: { Cookie: a.cookie } })).json();
  const crossTenantAttempt = await fetch(`${baseUrl}/api/school/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: b.cookie },
    body: JSON.stringify({ feeId: aFees.data[0].public_id, amount: 500, method: 'cash' }),
  });
  assert.equal(crossTenantAttempt.status, 404, 'cross-tenant resource access must be denied as not-found, not served');
});

test('an expired school is blocked from operational writes but can still read', async () => {
  const { cookie } = await login('accountant@expiredschool.demo', 'TestPass!2026');
  const readRes = await fetch(`${baseUrl}/api/school/students`, { headers: { Cookie: cookie } });
  assert.equal(readRes.status, 200);

  const writeRes = await fetch(`${baseUrl}/api/school/staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ firstName: 'X', lastName: 'Y', position: 'Clerk' }),
  });
  assert.equal(writeRes.status, 402);
});

test('account locks out after repeated failed logins', async () => {
  for (let i = 0; i < 5; i += 1) {
    await login('headteacher@testschool-b.demo', 'WrongPassword!1');
  }
  const { status, body } = await login('headteacher@testschool-b.demo', 'TestPass!2026');
  assert.equal(status, 423);
  assert.match(body.error, /locked/i);
});

test('registration/trial signup can never grant a privileged role directly', async () => {
  const res = await fetch(`${baseUrl}/api/onboarding/start-trial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schoolName: 'New Trial School',
      ownerUsername: 'trialowner',
      ownerEmail: 'owner@newtrial.demo',
      password: 'TrialPass!2026',
      role: 'PLATFORM_ADMIN', // attempted injection of a privileged role — must be ignored
    }),
  });
  assert.equal(res.status, 201);
  const { cookie } = await login('owner@newtrial.demo', 'TrialPass!2026');
  const me = await (await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(me.user.roles, ['SED']);
});
