// Real API checks in a disposable schema; existing employee data is untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../src/config/db');

async function main() {
  const schema = `manager_test_${process.pid}_${Date.now()}`;
  assert.match(schema, /^manager_test_\d+_\d+$/);
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
    const member2 = await insert('TEAM2', 'employee', manager);
    const outsider = await insert('OUT1', 'employee', otherManager);
    const unassigned = await insert('FREE1', 'employee');

    const secret = process.env.JWT_SECRET || 'isolated-manager-test-secret';
    process.env.JWT_SECRET = secret;
    const tokenFor = (id, role) => jwt.sign({ id, role }, secret);
    const adminToken = tokenFor(administrator, 'admin');
    const managerToken = tokenFor(manager, 'manager');
    const memberToken = tokenFor(member, 'employee');
    const outsiderToken = tokenFor(outsider, 'employee');

    const app = express();
    app.use(express.json());
    app.use('/attendance', require('../src/routes/attendance'));
    app.use('/leaves', require('../src/routes/leaves'));
    app.use('/loans', require('../src/routes/loans'));
    app.use('/advances', require('../src/routes/advances'));
    app.use('/team', require('../src/routes/team'));
    app.use('/payslips', require('../src/routes/payslips'));
    app.use('/employees', require('../src/routes/employees'));
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

    // ---- Leave: team-scoped approval ----
    const leave = await request('/leaves', 'POST', { leave_type: 'casual', start_date: '2026-03-02',
      end_date: '2026-03-03', reason: 'Family event' }, memberToken, 201);
    const outsiderLeave = await request('/leaves', 'POST', { leave_type: 'casual', start_date: '2026-03-02',
      end_date: '2026-03-02', reason: 'Trip' }, outsiderToken, 201);
    const managerOwnLeave = await request('/leaves', 'POST', { leave_type: 'casual', start_date: '2026-04-01',
      end_date: '2026-04-01', reason: 'Personal' }, managerToken, 201);
    const teamLeaves = await request('/leaves/team');
    assert.deepEqual(teamLeaves.map((row) => row.id), [leave.id], 'team list shows only direct reports');
    await request('/leaves', 'GET', null, managerToken, 403);
    await request('/leaves/team', 'GET', null, memberToken, 403);
    await request(`/leaves/${outsiderLeave.id}/status`, 'PATCH', { status: 'approved' }, managerToken, 404);
    await request(`/leaves/${managerOwnLeave.id}/status`, 'PATCH', { status: 'approved' }, managerToken, 404);
    await request(`/leaves/${leave.id}/status`, 'PATCH', { status: 'rejected' }, managerToken, 400);
    await request(`/leaves/${leave.id}/status`, 'PATCH', { status: 'approved' }, managerToken);
    const decided = (await request('/leaves', 'GET', null, adminToken)).find((row) => row.id === leave.id);
    assert.equal(decided.status, 'approved');
    assert.equal(decided.decided_by_name, 'MGR');
    await request(`/leaves/${managerOwnLeave.id}/status`, 'PATCH', { status: 'approved' }, adminToken);

    // ---- Attendance: team-scoped marking ----
    const day = await request('/attendance/day?date=2026-05-04');
    assert.deepEqual(day.map((row) => row.employee_id).sort(), [member, member2].sort());
    await request('/attendance/bulk', 'PUT', { work_date: '2026-05-04', records: [
      { employee_id: member, status: 'present', day_type: 'full' },
      { employee_id: member2, status: 'absent', day_type: 'full' }] });
    await request('/attendance/bulk', 'PUT', { work_date: '2026-05-04', records: [
      { employee_id: member, status: 'present' }, { employee_id: outsider, status: 'present' }] }, managerToken, 403);
    await request('/attendance/bulk', 'PUT', { work_date: '2026-05-04', records: [
      { employee_id: manager, status: 'present' }] }, managerToken, 403);
    const monthly = await request('/attendance?month=5&year=2026');
    assert.ok(monthly.length >= 2 && monthly.every((row) => [member, member2].includes(row.employee_id)));
    await request('/attendance/bulk', 'PUT', { work_date: '2026-05-04', records: [
      { employee_id: outsider, status: 'present', day_type: 'full' }] }, adminToken);
    const outsiderRecord = (await request('/attendance?month=5&year=2026', 'GET', null, adminToken))
      .find((row) => row.employee_id === outsider);
    await request(`/attendance/${outsiderRecord.id}`, 'DELETE', null, managerToken, 404);
    await request('/attendance/day?date=2026-05-04', 'GET', null, memberToken, 403);

    // ---- Loans and advances: manager recommendation before admin approval ----
    const loan = await request('/loans', 'POST', { amount: 1000, instalment_count: 2, interest_percentage: 0,
      first_recovery: '2027-01-01', reason: 'Medical' }, memberToken, 201);
    const outsiderLoan = await request('/loans', 'POST', { amount: 1000, instalment_count: 2, interest_percentage: 0,
      first_recovery: '2027-01-01', reason: 'Medical' }, outsiderToken, 201);
    assert.deepEqual((await request('/loans/team')).map((row) => row.id), [loan.id]);
    await request(`/loans/${loan.id}/status`, 'PATCH', { action: 'approve' }, adminToken, 409);
    await request(`/loans/${outsiderLoan.id}/recommendation`, 'PATCH', { decision: 'recommended' }, managerToken, 404);
    await request(`/loans/${loan.id}/recommendation`, 'PATCH', { decision: 'declined' }, managerToken, 400);
    await request(`/loans/${loan.id}/recommendation`, 'PATCH', { decision: 'maybe' }, managerToken, 400);
    await request(`/loans/${loan.id}/recommendation`, 'PATCH', { decision: 'recommended', note: 'Genuine need' }, memberToken, 403);
    await request(`/loans/${loan.id}/recommendation`, 'PATCH', { decision: 'recommended', note: 'Genuine need' });
    const detail = await request(`/loans/${loan.id}`, 'GET', null, adminToken);
    assert.equal(detail.manager_decision, 'recommended');
    assert.equal(detail.manager_decided_by_name, 'MGR');
    assert.ok(detail.events.some((event) => event.action === 'manager_recommend'));
    await request(`/loans/${loan.id}/status`, 'PATCH', { action: 'approve' }, adminToken);
    await request(`/loans/${loan.id}/recommendation`, 'PATCH', { decision: 'declined', note: 'late' }, managerToken, 409);
    // Requests from employees without a manager keep the direct admin flow.
    const freeLoan = await request('/loans', 'POST', { amount: 1000, instalment_count: 2, interest_percentage: 0,
      first_recovery: '2027-01-01', reason: 'Medical' }, tokenFor(unassigned, 'employee'), 201);
    await request(`/loans/${freeLoan.id}/status`, 'PATCH', { action: 'approve' }, adminToken);
    const advance = await request('/advances', 'POST', { amount: 500, first_recovery: '2027-01-01' }, memberToken, 201);
    await request(`/advances/${advance.id}/status`, 'PATCH', { action: 'approve' }, adminToken, 409);
    await request(`/advances/${advance.id}/recommendation`, 'PATCH', { decision: 'declined', note: 'Not now' });
    assert.equal((await request(`/advances/${advance.id}`, 'GET', null, adminToken)).manager_decision, 'declined');
    await request(`/advances/${advance.id}/status`, 'PATCH', { action: 'reject', note: 'Per manager' }, adminToken);

    // ---- Team dashboard and report (no salary data) ----
    const summary = await request('/team/summary');
    assert.equal(summary.team_size, 2);
    assert.deepEqual(summary.members.map((row) => row.id).sort(), [member, member2].sort());
    assert.ok(!JSON.stringify(summary).includes('basic'));
    assert.equal(summary.pending_loans, 0);
    const report = await request('/team/report?month=5&year=2026');
    const row = report.members.find((item) => item.id === member);
    assert.equal(row.present_days, 1);
    assert.equal(report.members.find((item) => item.id === member2).absent_days, 1);
    assert.ok(!JSON.stringify(report).includes('basic'));
    await request('/team/report?month=13&year=2026', 'GET', null, managerToken, 400);
    await request('/team/summary', 'GET', null, adminToken, 403);

    // ---- Payroll: manager calculates, admin approves, manager publishes ----
    const june = { month: 6, year: 2026 };
    const base = `http://127.0.0.1:${server.address().port}`;
    const memberSlips = async (token) => request('/payslips/my', 'GET', null, token);
    const checklist = await request('/payslips/checklist?month=6&year=2026');
    assert.deepEqual(checklist.employees.map((row) => row.employee_id).sort(), [member, member2].sort());
    await request('/payslips/preview', 'POST', { ...june, employee_id: outsider }, managerToken, 400);
    await request('/payslips/generate', 'POST', { ...june, employee_id: outsider }, managerToken, 400);
    await request('/payslips/generate', 'POST', june, memberToken, 403);
    assert.equal((await request('/payslips/generate', 'POST', june, managerToken, 201)).generated, 2);
    await request('/payslips/generate', 'POST', { ...june, employee_id: outsider }, adminToken, 201);
    const teamSlips = await request('/payslips?month=6&year=2026');
    assert.deepEqual(teamSlips.map((row) => row.employee_id).sort(), [member, member2].sort(), 'manager sees only team payroll');
    const slip = teamSlips.find((row) => row.employee_id === member);
    const slip2 = teamSlips.find((row) => row.employee_id === member2);
    const outsiderSlip = (await request('/payslips?month=6&year=2026', 'GET', null, adminToken)).find((row) => row.employee_id === outsider);
    assert.equal(slip.status, 'draft');
    assert.equal((await memberSlips(memberToken)).length, 0, 'draft payslips are hidden from employees');

    // Managers cannot approve, finalize, record payment, delete or touch outside payroll.
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'finalized' }, managerToken, 403);
    await request(`/payslips/${slip.id}/payment`, 'PATCH', { payment_status: 'paid' }, managerToken, 403);
    await request(`/payslips/${slip.id}`, 'DELETE', null, managerToken, 403);
    await request(`/payslips/${outsiderSlip.id}/submit`, 'PATCH', undefined, managerToken, 404);
    await request(`/payslips/${slip.id}/publish`, 'PATCH', undefined, managerToken, 409);

    // Submit, return with a reason, resubmit.
    await request(`/payslips/${slip.id}/submit`, 'PATCH', undefined, managerToken);
    await request(`/payslips/${slip.id}/submit`, 'PATCH', undefined, managerToken, 409);
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'draft' }, adminToken, 400);
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'draft', reason: 'Check late logins' }, adminToken);
    await request(`/payslips/${slip.id}/submit`, 'PATCH', undefined, managerToken);
    const bulkSubmit = await request('/payslips/submit', 'POST', june, managerToken);
    assert.equal(bulkSubmit.count, 1, 'bulk submit sends only remaining drafts');
    await request(`/payslips/${slip2.id}/publish`, 'PATCH', undefined, managerToken, 409);

    // Administrator approval (finalize), then the manager publishes.
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'finalized' }, adminToken);
    await request(`/payslips/${slip2.id}/status`, 'PATCH', { status: 'finalized' }, adminToken);
    assert.equal((await memberSlips(memberToken)).length, 0, 'approved payslips stay hidden until published');
    await request(`/payslips/${slip.id}/publish`, 'PATCH', undefined, managerToken);
    await request(`/payslips/${slip.id}/publish`, 'PATCH', undefined, managerToken, 409);
    assert.equal((await memberSlips(memberToken)).length, 1);
    assert.equal((await memberSlips(tokenFor(member2, 'employee'))).length, 0);
    assert.equal((await request('/payslips/publish', 'POST', june, managerToken)).count, 1);
    assert.equal((await memberSlips(tokenFor(member2, 'employee'))).length, 1);
    const download = (id, token) => fetch(`${base}/payslips/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await download(slip.id, memberToken)).status, 200);
    assert.equal((await download(slip.id, managerToken)).status, 404, 'managers cannot download team PDFs');

    // Reopening for correction withdraws publication.
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'draft', reason: 'Correction' }, adminToken);
    assert.equal((await memberSlips(memberToken)).length, 0);
    const trail = (await pool.query('SELECT action FROM payroll_events WHERE payslip_id = $1 ORDER BY id', [slip.id])).rows.map((row) => row.action);
    for (const step of ['generated', 'submitted', 'finalized', 'published', 'reopened']) assert.ok(trail.includes(step), `audit includes ${step}`);

    // ---- Role administration ----
    await request(`/employees/${unassigned}`, 'PUT', { manager_id: unassigned }, adminToken, 400);
    await request(`/employees/${unassigned}`, 'PUT', { manager_id: member }, adminToken, 400);
    await request(`/employees/${unassigned}`, 'PUT', { manager_id: manager }, adminToken);
    await request(`/employees/${manager}`, 'PUT', { role: 'employee' }, adminToken, 400);
    await request(`/employees/${unassigned}`, 'PUT', { role: 'admin' }, adminToken, 400);
    await request(`/employees/${manager}`, 'PUT', { manager_id: otherManager }, adminToken);
    await request(`/employees/${otherManager}`, 'PUT', { manager_id: manager }, adminToken, 400);
    await request('/employees', 'GET', null, managerToken, 403);

    // Deactivating a manager releases their team to admin approval.
    await request(`/employees/${manager}`, 'DELETE', null, adminToken);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM employees WHERE manager_id = $1', [manager])).rows[0].n, 0);
    await request('/team/summary', 'GET', null, managerToken, 401);

    console.log('Passed: team-scoped leave approval with audit, manager payroll calculation, submission, admin approval and publishing with employee visibility gating, team attendance marking and scoping, loan/advance recommendation gate, own-team dashboard and report without salary data, role and reporting-line rules, and manager deactivation.');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
