// Real API checks in a disposable schema: server-side sessions, httpOnly cookie, no token in responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../src/config/db');

async function main() {
  const schema = `session_test_${process.pid}_${Date.now()}`;
  assert.match(schema, /^session_test_\d+_\d+$/);
  const admin = new Client({ ...pool.options, connectionTimeoutMillis: 5000 });
  let server, schemaCreated = false;
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    pool.options.options = `-c search_path=${schema}`;
    await pool.query(fs.readFileSync(path.join(__dirname, '../src/schema.sql'), 'utf8'));

    const hash = await bcrypt.hash('Temp-Pass-123', 4);
    const insert = async (code, role, mustChange = false) => (await pool.query(
      `INSERT INTO employees (emp_code,name,email,password_hash,role,must_change_password,basic,joining_date)
       VALUES ($1,$1,$2,$3,$4,$5,31000,'2020-01-01') RETURNING id`,
      [code, `${code.toLowerCase()}@test.invalid`, hash, role, mustChange])).rows[0].id;
    const administrator = await insert('ADMIN', 'admin');
    const staff = await insert('STAFF', 'employee');
    const fresh = await insert('FRESH', 'employee', true);

    const secret = process.env.JWT_SECRET || 'isolated-session-test-secret';
    process.env.JWT_SECRET = secret;

    const app = express();
    app.use(express.json());
    app.use('/auth', require('../src/routes/auth'));
    app.use('/attendance', require('../src/routes/attendance'));
    app.use('/employees', require('../src/routes/employees'));
    app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    // Minimal browser: remembers the session cookie and sends it back.
    function browser() {
      let cookie = '';
      return {
        get cookie() { return cookie; },
        async call(url, { method = 'GET', body, csrf = true, expected = 200, headers = {} } = {}) {
          const response = await fetch(`${base}${url}`, {
            method,
            headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-Requested-With': 'payroll-web' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          const set = response.headers.getSetCookie?.() || [];
          if (set.length) {
            const value = set[0].split(';')[0];
            cookie = value.endsWith('=') ? '' : value;
          }
          const data = await response.json().catch(() => ({}));
          assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(data)}`);
          return { data, set };
        },
      };
    }
    const login = (b, email, password = 'Temp-Pass-123', expected = 200) =>
      b.call('/auth/login', { method: 'POST', body: { email, password }, expected });

    // ---- Sign-in creates a server-side session and an httpOnly cookie, never a token ----
    const one = browser();
    await login(one, 'staff@test.invalid', 'wrong-password', 401);
    const signedIn = await login(one, 'staff@test.invalid');
    assert.equal(signedIn.data.token, undefined, 'no token is returned to the browser');
    assert.equal(signedIn.data.user.role, 'employee');
    assert.equal(signedIn.data.user.must_change_password, false);
    assert.ok(!('password_hash' in signedIn.data.user));
    const header = signedIn.set[0];
    assert.match(header, /^payroll_session=[0-9a-f]{64};/);
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Lax/i);
    const stored = (await pool.query('SELECT token_hash FROM sessions WHERE employee_id = $1', [staff])).rows;
    assert.equal(stored.length, 1);
    assert.ok(!header.includes(stored[0].token_hash), 'the database stores only a hash of the cookie value');

    // ---- Session identifies the user for every API ----
    assert.equal((await one.call('/auth/me')).data.user.name, 'STAFF');
    await one.call('/attendance/my');
    await one.call('/employees', { expected: 403 });
    await browser().call('/auth/me', { expected: 401 });
    await browser().call('/attendance/my', { expected: 401 });
    await browser().call('/attendance/my', { headers: { Cookie: 'payroll_session=' + '0'.repeat(64) }, expected: 401 });

    // ---- Cookie-authenticated changes need the anti-CSRF header ----
    await one.call('/auth/change-password', { method: 'POST', body: { currentPassword: 'x', newPassword: 'Another-Pass-1' }, csrf: false, expected: 403 });
    await one.call('/auth/change-password', { method: 'POST', body: { currentPassword: 'wrong', newPassword: 'Another-Pass-1' }, expected: 400 });

    // ---- Bearer tokens remain valid for service clients ----
    const service = jwt.sign({ id: staff, role: 'employee' }, secret);
    await browser().call('/attendance/my', { headers: { Authorization: `Bearer ${service}` } });

    // ---- Logout destroys the session on the server ----
    const out = await one.call('/auth/logout', { method: 'POST' });
    assert.match(out.set[0], /payroll_session=;/);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM sessions WHERE employee_id = $1', [staff])).rows[0].n, 0);
    const replay = browser();
    await replay.call('/auth/me', { headers: { Cookie: header.split(';')[0] }, expected: 401 });

    // ---- Expired, deactivated and password-reset accounts lose access immediately ----
    const expiring = browser();
    await login(expiring, 'staff@test.invalid');
    await pool.query("UPDATE sessions SET expires_at = NOW() - interval '1 minute' WHERE employee_id = $1", [staff]);
    await expiring.call('/auth/me', { expected: 401 });

    const deactivated = browser();
    await login(deactivated, 'staff@test.invalid');
    await pool.query('UPDATE employees SET is_active = FALSE WHERE id = $1', [staff]);
    await deactivated.call('/auth/me', { expected: 401 });
    await login(browser(), 'staff@test.invalid', 'Temp-Pass-123', 401);
    await pool.query('UPDATE employees SET is_active = TRUE WHERE id = $1', [staff]);

    const boss = browser();
    await login(boss, 'admin@test.invalid');
    const victim = browser();
    await login(victim, 'staff@test.invalid');
    await boss.call(`/employees/${staff}`, { method: 'PUT', body: { password: 'Reset-By-Admin-1' } });
    await victim.call('/auth/me', { expected: 401 });
    await login(browser(), 'staff@test.invalid', 'Reset-By-Admin-1');

    // ---- First sign-in with a temporary password: only change-password is allowed ----
    const newcomer = browser();
    const other = browser();
    const first = await login(newcomer, 'fresh@test.invalid');
    assert.equal(first.data.user.must_change_password, true);
    await login(other, 'fresh@test.invalid');
    const me = await newcomer.call('/auth/me', { expected: 403 });
    assert.equal(me.data.code, 'PASSWORD_CHANGE_REQUIRED');
    await newcomer.call('/attendance/my', { expected: 403 });
    await newcomer.call('/auth/change-password', { method: 'POST', body: { currentPassword: 'Temp-Pass-123', newPassword: 'short' }, expected: 400 });
    await newcomer.call('/auth/change-password', { method: 'POST', body: { currentPassword: 'Temp-Pass-123', newPassword: 'My-Own-Password-9' } });
    assert.equal((await newcomer.call('/auth/me')).data.user.must_change_password, false);
    await newcomer.call('/attendance/my');
    await other.call('/auth/me', { expected: 401 });
    await login(browser(), 'fresh@test.invalid', 'Temp-Pass-123', 401);
    await login(browser(), 'fresh@test.invalid', 'My-Own-Password-9');

    // ---- Admin-created accounts: email + temporary password, replaced at first sign-in ----
    const base2 = { designation: 'Developer', gender: 'female', dob: '2000-01-01', joining_date: '2026-10-01', basic: 10000 };
    const created = await boss.call('/employees', { method: 'POST', expected: 201,
      body: { ...base2, emp_code: 'NEW1', name: 'New One', email: 'new1@test.invalid', password: 'Temp-Created-1' } });
    assert.equal(created.data.must_change_password, true, 'created accounts default to a temporary password');
    await boss.call('/employees', { method: 'POST', expected: 400,
      body: { ...base2, emp_code: 'NEW2', name: 'Short', email: 'new2@test.invalid', password: 'short' } });
    const optedOut = await boss.call('/employees', { method: 'POST', expected: 201,
      body: { ...base2, emp_code: 'NEW3', name: 'Permanent', email: 'new3@test.invalid', password: 'Chosen-By-Admin-1', require_password_change: false } });
    assert.equal(optedOut.data.must_change_password, false);
    const newbie = browser();
    assert.equal((await login(newbie, 'new1@test.invalid', 'Temp-Created-1')).data.user.must_change_password, true);
    await newbie.call('/attendance/my', { expected: 403 });
    await newbie.call('/auth/change-password', { method: 'POST', body: { currentPassword: 'Temp-Created-1', newPassword: 'Employee-Chosen-1' } });
    await newbie.call('/attendance/my');
    await login(browser(), 'new3@test.invalid', 'Chosen-By-Admin-1');
    await boss.call(`/employees/${created.data.id}`, { method: 'PUT', body: { password: 'Short' }, expected: 400 });
    const reset = await boss.call(`/employees/${created.data.id}`, { method: 'PUT', body: { password: 'Reset-Again-123' } });
    assert.equal(reset.data.must_change_password, true, 'an admin reset is temporary by default');
    await newbie.call('/auth/me', { expected: 401 });
    const kept = await boss.call(`/employees/${created.data.id}`, { method: 'PUT', body: { password: 'Reset-Keep-123', require_password_change: false } });
    assert.equal(kept.data.must_change_password, false);
    const untouched = await boss.call(`/employees/${created.data.id}`, { method: 'PUT', body: { designation: 'Lead' } });
    assert.equal(untouched.data.must_change_password, false, 'edits without a password leave the flag alone');
    assert.ok(administrator && fresh);

    console.log('Passed: server-side sessions with hashed storage, httpOnly SameSite cookie, no token returned, anti-CSRF header, logout and replay protection, expiry, deactivation and admin reset revocation, forced first-login password change, admin-set temporary passwords on create and reset, and bearer compatibility.');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
