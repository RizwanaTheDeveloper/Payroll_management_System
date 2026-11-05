// Real API checks in a disposable schema: attendance regularization, approval routing, escalation,
// payroll-lock controls for managers, and live notification counts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../src/config/db');

// Calendar date in IST, n days ago.
const ago = (n) => new Date(Date.now() - n * 864e5 + 5.5 * 3600e3).toISOString().slice(0, 10);

async function main() {
  const schema = `approvals_test_${process.pid}_${Date.now()}`;
  assert.match(schema, /^approvals_test_\d+_\d+$/);
  const admin = new Client({ ...pool.options, connectionTimeoutMillis: 5000 });
  let server, schemaCreated = false;
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    pool.options.options = `-c search_path=${schema}`;
    await pool.query(fs.readFileSync(path.join(__dirname, '../src/schema.sql'), 'utf8'));

    const insert = async (code, role, managerId = null) => (await pool.query(
      `INSERT INTO employees (emp_code,name,email,password_hash,role,manager_id,basic,joining_date)
       VALUES ($1,$1,$2,'unused',$3,$4,31000,'2020-01-01') RETURNING id`,
      [code, `${code.toLowerCase()}@test.invalid`, role, managerId])).rows[0].id;
    const administrator = await insert('ADMIN', 'admin');
    const manager = await insert('MGR', 'manager');
    const otherManager = await insert('MGR2', 'manager');
    const member = await insert('TEAM1', 'employee', manager);
    const outsider = await insert('OUT1', 'employee', otherManager);
    const solo = await insert('SOLO', 'employee');

    const secret = process.env.JWT_SECRET || 'isolated-approvals-test-secret';
    process.env.JWT_SECRET = secret;
    const tokenFor = (id, role) => jwt.sign({ id, role }, secret);
    const adminToken = tokenFor(administrator, 'admin');
    const managerToken = tokenFor(manager, 'manager');
    const memberToken = tokenFor(member, 'employee');
    const outsiderToken = tokenFor(outsider, 'employee');
    const soloToken = tokenFor(solo, 'employee');

    const app = express();
    app.use(express.json());
    app.use('/attendance', require('../src/routes/attendance'));
    app.use('/attendance-requests', require('../src/routes/attendanceRequests'));
    app.use('/leaves', require('../src/routes/leaves'));
    app.use('/loans', require('../src/routes/loans'));
    app.use('/notifications', require('../src/routes/notifications'));
    app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    async function request(url, method = 'GET', body, auth = managerToken, expected = 200) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(data)}`);
      return data;
    }
    const attendanceOn = async (id, day) => (await pool.query(
      'SELECT status, day_type, note, marked_by FROM attendance WHERE employee_id = $1 AND work_date = $2', [id, day])).rows[0];

    // ---- Requesting a correction ----
    const d1 = ago(5), d2 = ago(4), d3 = ago(3), d4 = ago(6);
    const ask = (token, body, expected = 201) => request('/attendance-requests', 'POST', body, token, expected);
    await ask(memberToken, { work_date: ago(-2), reason: 'future' }, 400);
    await ask(memberToken, { work_date: ago(90), reason: 'too old' }, 400);
    await ask(memberToken, { work_date: d1, reason: '  ' }, 400);
    await ask(memberToken, { work_date: d1, reason: 'x', day_type: 'quarter' }, 400);
    await ask(memberToken, { work_date: '2026-13-45', reason: 'bad date' }, 400);
    await request('/attendance-requests', 'POST', { work_date: d1, reason: 'x' }, adminToken, 403);
    const first = await ask(memberToken, { work_date: d1, reason: 'Forgot to sign in; worked from the office' });
    await ask(memberToken, { work_date: d1, reason: 'again' }, 409);
    await pool.query(`INSERT INTO attendance (employee_id, work_date, status, day_type) VALUES ($1,$2,'present','full'), ($1,$3,'leave','full')`, [member, d2, d3]);
    await ask(memberToken, { work_date: d2, reason: 'already present' }, 409);
    await ask(memberToken, { work_date: d3, reason: 'already leave' }, 409);
    const outsiderRequest = await ask(outsiderToken, { work_date: d1, reason: 'Power cut' });
    const soloRequest = await ask(soloToken, { work_date: d1, reason: 'No manager assigned' });

    // ---- Routing: manager sees own team only; no manager means an administrator decides ----
    assert.deepEqual((await request('/attendance-requests/team')).map((row) => row.id), [first.id]);
    assert.deepEqual((await request('/attendance-requests/my', 'GET', null, memberToken)).map((row) => row.id), [first.id]);
    assert.equal((await request('/attendance-requests', 'GET', null, adminToken)).length, 3);
    await request('/attendance-requests', 'GET', null, managerToken, 403);
    await request('/attendance-requests/team', 'GET', null, memberToken, 403);
    const decide = (id, body, token = managerToken, expected = 200) => request(`/attendance-requests/${id}/decision`, 'PATCH', body, token, expected);
    await decide(outsiderRequest.id, { decision: 'approved' }, managerToken, 404);
    await decide(soloRequest.id, { decision: 'approved' }, managerToken, 404);
    await decide(first.id, { decision: 'approved' }, memberToken, 403);
    await decide(first.id, { decision: 'rejected' }, managerToken, 400);
    await decide(first.id, { decision: 'maybe' }, managerToken, 400);

    // ---- Approval records attendance with who marked it ----
    await decide(first.id, { decision: 'approved', note: 'Verified with the front desk' });
    const marked = await attendanceOn(member, d1);
    assert.equal(marked.status, 'present');
    assert.equal(marked.marked_by, manager);
    assert.match(marked.note, /^Regularized: Forgot to sign in/);
    await decide(first.id, { decision: 'approved' }, managerToken, 409);
    const shown = (await request('/attendance-requests/my', 'GET', null, memberToken))[0];
    assert.equal(shown.status, 'approved');
    assert.equal(shown.decided_by_name, 'MGR');
    assert.equal(shown.manager_name, 'MGR');

    // ---- Rejection and withdrawal leave attendance untouched ----
    await decide(soloRequest.id, { decision: 'rejected', note: 'Not supported by the access log' }, adminToken);
    assert.equal(await attendanceOn(solo, d1), undefined);
    const withdraw = await ask(memberToken, { work_date: d4, reason: 'Changed my mind' });
    await request(`/attendance-requests/${withdraw.id}`, 'DELETE', null, soloToken, 404);
    await request(`/attendance-requests/${withdraw.id}`, 'DELETE', null, memberToken);
    await request(`/attendance-requests/${withdraw.id}`, 'DELETE', null, memberToken, 404);
    await decide(withdraw.id, { decision: 'approved' }, managerToken, 409);

    // ---- Finalized payroll cannot be changed by a manager ----
    const pendingBefore = await ask(memberToken, { work_date: d4, reason: 'Late punch' });
    await pool.query(`INSERT INTO payslips (employee_id, month, year, basic, net_pay, status) VALUES ($1,$2,$3,31000,31000,'finalized')`,
      [member, Number(d4.slice(5, 7)), Number(d4.slice(0, 4))]);
    await decide(pendingBefore.id, { decision: 'approved' }, managerToken, 409);
    await decide(pendingBefore.id, { decision: 'approved' }, adminToken, 409);
    await ask(memberToken, { work_date: d4, reason: 'Duplicate of a pending request' }, 409);
    await request(`/attendance-requests/${pendingBefore.id}`, 'DELETE', null, memberToken);
    await ask(memberToken, { work_date: d4, reason: 'New request in a finalized month' }, 409);
    const lockedDay = d4;
    await request('/attendance/bulk', 'PUT', { work_date: lockedDay, records: [{ employee_id: member, status: 'present' }] }, managerToken, 409);
    await request('/attendance/bulk', 'PUT', { work_date: lockedDay, records: [{ employee_id: member, status: 'present' }] }, adminToken);
    const adminMarked = (await request(`/attendance?month=${Number(lockedDay.slice(5, 7))}&year=${Number(lockedDay.slice(0, 4))}`, 'GET', null, adminToken))
      .find((row) => row.employee_id === member && row.work_date === lockedDay);
    assert.equal(adminMarked.marked_by_name, 'ADMIN', 'attendance edits record who made them');
    const lockedRecord = (await pool.query('SELECT id FROM attendance WHERE employee_id = $1 AND work_date = $2', [member, lockedDay])).rows[0].id;
    await request(`/attendance/${lockedRecord}`, 'DELETE', null, managerToken, 409);

    // Leave approval is guarded the same way.
    const leave = await request('/leaves', 'POST', { leave_type: 'casual', start_date: lockedDay, end_date: lockedDay, reason: 'Back-dated' }, memberToken, 201);
    assert.equal((await request('/leaves/team'))[0].manager_name, 'MGR');
    assert.equal((await request('/leaves/team'))[0].waiting_days, 0);
    await request(`/leaves/${leave.id}/status`, 'PATCH', { status: 'approved' }, managerToken, 409);
    await request(`/leaves/${leave.id}/status`, 'PATCH', { status: 'approved' }, adminToken);
    assert.equal((await attendanceOn(member, lockedDay)).marked_by, administrator);

    await pool.query('DELETE FROM payslips WHERE employee_id = $1', [member]);

    // ---- Live notification counts follow the routing ----
    const open = await ask(memberToken, { work_date: ago(10), reason: 'For counts' });
    const pendingLeave = await request('/leaves', 'POST', { leave_type: 'sick', start_date: ago(-10), end_date: ago(-10), reason: 'Flu' }, memberToken, 201);
    const soloLeave = await request('/leaves', 'POST', { leave_type: 'sick', start_date: ago(-20), end_date: ago(-20), reason: 'Flu' }, soloToken, 201);
    const loan = await request('/loans', 'POST', { amount: 1000, instalment_count: 2, interest_percentage: 0, first_recovery: '2027-01-01', reason: 'Medical' }, memberToken, 201);
    const managerCounts = (await request('/notifications')).counts;
    assert.equal(managerCounts.leave_pending, 1);
    assert.equal(managerCounts.attendance_requests_pending, 1);
    assert.equal(managerCounts.credit_pending, 1);
    let adminCounts = (await request('/notifications', 'GET', null, adminToken)).counts;
    assert.equal(adminCounts.leave_pending, 1, 'only the unmanaged leave is the administrator\'s at first');
    assert.equal(adminCounts.loans_pending, 0, 'a loan waits for the manager\'s recommendation first');
    assert.equal(adminCounts.attendance_requests_pending, 0);
    await request(`/loans/${loan.id}/recommendation`, 'PATCH', { decision: 'recommended' });
    assert.equal((await request('/notifications')).counts.credit_pending, 0);
    adminCounts = (await request('/notifications', 'GET', null, adminToken)).counts;
    assert.equal(adminCounts.loans_pending, 1, 'recommended loans move to the administrator');

    // Undecided work escalates to the administrator after the policy window.
    await pool.query(`UPDATE leaves SET applied_at = NOW() - interval '5 days' WHERE id = $1`, [pendingLeave.id]);
    await pool.query(`UPDATE attendance_requests SET created_at = NOW() - interval '5 days' WHERE id = $1`, [open.id]);
    adminCounts = (await request('/notifications', 'GET', null, adminToken)).counts;
    assert.equal(adminCounts.leave_pending, 2);
    assert.equal(adminCounts.attendance_requests_pending, 1);
    assert.equal((await request('/leaves/team'))[0].waiting_days >= 5, true);
    assert.equal((await request('/leaves/team')).find((row) => row.id === pendingLeave.id).escalated, true, 'old pending leave is flagged escalated');
    assert.equal((await request('/leaves', 'GET', null, adminToken)).find((row) => row.id === soloLeave.id).escalated, false, 'no manager means no escalation');
    assert.equal((await request('/attendance-requests', 'GET', null, adminToken)).find((row) => row.id === open.id).escalated, true);
    assert.deepEqual((await request('/notifications', 'GET', null, memberToken)).counts, {});
    await request('/notifications', 'GET', null, 'bad-token', 401);
    // An unanswered loan can be decided by the administrator once it has escalated.
    const stale = await request('/loans', 'POST', { amount: 500, instalment_count: 2, interest_percentage: 0, first_recovery: '2027-01-01', reason: 'Urgent' }, memberToken, 201);
    await request(`/loans/${stale.id}/status`, 'PATCH', { action: 'approve' }, adminToken, 409);
    await pool.query(`UPDATE advances SET created_at = NOW() - interval '5 days' WHERE id = $1`, [stale.id]);
    await request(`/loans/${stale.id}/status`, 'PATCH', { action: 'approve' }, adminToken);
    // ---- Check in / check out ----
    const todayIst = ago(0);
    assert.equal((await request('/attendance/today', 'GET', null, memberToken)).record, null);
    await request('/attendance/check-in', 'POST', null, adminToken, 403);
    await request('/attendance/today', 'GET', null, adminToken, 403);
    await request('/attendance/check-out', 'POST', null, memberToken, 409);
    const checkedIn = await request('/attendance/check-in', 'POST', null, memberToken, 201);
    assert.equal(checkedIn.record.status, 'present');
    assert.ok(checkedIn.record.check_in && !checkedIn.record.check_out);
    const rowIn = (await pool.query('SELECT check_in::text AS check_in, work_date::text AS work_date, marked_by FROM attendance WHERE employee_id = $1 AND work_date = $2', [member, todayIst])).rows[0];
    assert.ok(rowIn.check_in.startsWith(todayIst), 'check-in is stored on the IST date of today');
    assert.equal(rowIn.marked_by, member);
    await request('/attendance/check-in', 'POST', null, memberToken, 409);
    const checkedOut = await request('/attendance/check-out', 'POST', null, memberToken);
    assert.ok(checkedOut.record.check_out);
    assert.ok(new Date(checkedOut.record.check_out) >= new Date(checkedOut.record.check_in));
    await request('/attendance/check-out', 'POST', null, memberToken, 409);
    assert.equal((await request('/attendance/today', 'GET', null, memberToken)).date, todayIst);
    // Other states of today
    await request('/attendance/bulk', 'PUT', { work_date: todayIst, records: [{ employee_id: solo, status: 'absent' }] }, adminToken);
    await request('/attendance/check-in', 'POST', null, soloToken, 409);
    await request('/attendance/bulk', 'PUT', { work_date: todayIst, records: [{ employee_id: solo, status: 'leave' }] }, adminToken);
    await request('/attendance/check-in', 'POST', null, soloToken, 409);
    await request('/attendance/bulk', 'PUT', { work_date: todayIst, records: [{ employee_id: solo, status: 'present' }] }, adminToken);
    const timeAdded = await request('/attendance/check-in', 'POST', null, soloToken, 201);
    assert.ok(timeAdded.record.check_in, 'a day marked present without a time gets the check-in time');
    await pool.query('UPDATE employees SET resignation_date = $2 WHERE id = $1', [outsider, ago(1)]);
    await request('/attendance/check-in', 'POST', null, outsiderToken, 400);

    // ---- Corrections can carry the missing check-in / check-out time ----
    await ask(memberToken, { work_date: d2, reason: 'bad time', check_out_time: '6:30pm' }, 400);
    await ask(memberToken, { work_date: d2, reason: 'backwards', check_in_time: '18:00', check_out_time: '09:00' }, 400);
    const forgot = await ask(memberToken, { work_date: d2, reason: 'Forgot to check out', check_in_time: '09:05', check_out_time: '18:30' });
    const listed = (await request('/attendance-requests/my', 'GET', null, memberToken)).find((row) => row.id === forgot.id);
    assert.equal(listed.check_in_time, '09:05');
    assert.equal(listed.check_out_time, '18:30');
    await decide(forgot.id, { decision: 'approved' });
    const fixed = (await pool.query('SELECT check_in::text AS check_in, check_out::text AS check_out FROM attendance WHERE employee_id = $1 AND work_date = $2', [member, d2])).rows[0];
    assert.ok(fixed.check_in.endsWith('09:05:00') && fixed.check_out.endsWith('18:30:00'), 'approval records the requested times');
    await ask(memberToken, { work_date: d2, reason: 'No times, already present' }, 409);
    assert.ok(soloLeave && outsider);

    console.log('Passed: attendance regularization with routing to manager or administrator, audit of who marked attendance, rejection and withdrawal, finalized-payroll controls for managers, pending-with and waiting-days on leave, escalation (including admin approval of an unanswered loan), live notification counts, check-in/check-out and corrections with times.');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
