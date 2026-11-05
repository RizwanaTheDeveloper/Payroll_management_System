// Real API and calculation checks in an isolated schema; existing data is untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../src/config/db');

async function main() {
  const schema = `payroll_test_${process.pid}_${Date.now()}`;
  const admin = new Client({ ...pool.options, connectionTimeoutMillis: 5000 });
  let server, created = false;
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    pool.options.options = `-c search_path=${schema}`;
    const ddl = fs.readFileSync(path.join(__dirname, '../src/schema.sql'), 'utf8');
    await pool.query(ddl);
    const administrator = (await pool.query(`INSERT INTO employees (emp_code,name,email,password_hash,role)
      VALUES ('A1','Admin','admin@test.invalid','unused','admin') RETURNING id`)).rows[0].id;
    const employee = (await pool.query(`INSERT INTO employees
      (emp_code,name,email,password_hash,role,basic,hra,epf,professional_tax,joining_date)
      VALUES ('E1','Mid-month joiner','joiner@test.invalid','unused','employee',30000,6000,1800,200,'2026-09-16') RETURNING id`)).rows[0].id;
    const other = (await pool.query(`INSERT INTO employees (emp_code,name,email,password_hash,role,basic,joining_date)
      VALUES ('E2','Other employee','other@test.invalid','unused','employee',10000,'2020-01-01') RETURNING id`)).rows[0].id;
    const secret = 'isolated-payroll-test-secret'; process.env.JWT_SECRET = secret;
    const token = jwt.sign({ id: administrator, role: 'admin' }, secret);
    const employeeToken = jwt.sign({ id: employee, role: 'employee' }, secret);
    const otherToken = jwt.sign({ id: other, role: 'employee' }, secret);
    const app = express(); app.use(express.json());
    app.use('/employees', require('../src/routes/employees'));
    app.use('/auth', require('../src/routes/auth'));
    app.use('/payslips', require('../src/routes/payslips'));
    app.use('/attendance', require('../src/routes/attendance'));
    app.use('/reports', require('../src/routes/reports'));
    app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
    server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(url, method = 'GET', body, expected = 200, auth = token) {
      const response = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(result)}`);
      return result;
    }
    const payload = { employee_id: employee, month: 9, year: 2026 };
    for (const bad of ['oops', 'NaN', 'Infinity', -1, '1.001', true, [], {}, 1000000000]) {
      await request('/payslips/generate', 'POST', { ...payload, allowances: bad }, 400);
      await request(`/employees/${employee}`, 'PUT', { basic: bad }, 400);
    }
    for (const bad of [0, 13, 1.5, true]) await request('/payslips/generate', 'POST', { ...payload, month: bad }, 400);
    await request('/payslips/generate', 'POST', { ...payload, year: 2026.5 }, 400);
    await request('/payslips/generate', 'POST', payload, 403, employeeToken);
    await request('/payslips/checklist?month=9&year=2026', 'GET', null, 401, null);
    await request('/attendance/bulk', 'PUT', { work_date: '2026-09-17', records: [{ employee_id: employee, status: 'absent' }] });
    const preview = await request('/payslips/preview', 'POST', payload);
    assert.equal(preview.basic, 15000); assert.equal(preview.hra, 3000);
    assert.equal(preview.gross, 18000); assert.equal(preview.unpaid_leave_deduction, 1200);
    assert.equal(preview.net_pay, 14800); assert.equal(preview.employed_days, 15); assert.equal(preview.net_paid_days, 14);
    assert.equal((await request('/payslips')).length, 0, 'Preview does not create payslips');
    await request('/payslips/generate', 'POST', payload, 201);
    const getSlip = async (id, month) => (await request('/payslips')).find((row) => row.employee_id === id && row.month === month);
    let slip = await getSlip(employee, 9);
    const initialSalary = (await pool.query(
      'SELECT effective_from::text FROM salary_history WHERE employee_id = $1',
      [employee]
    )).rows[0];
    assert.equal(initialSalary.effective_from, '2026-09-16', 'Initial salary starts on the joining date');
    assert.equal(Number(slip.net_pay), preview.net_pay); assert.equal(slip.status, 'draft');
    assert.equal(Number(slip.additional_deductions), 0);
    const oldSnapshot = slip.calculation_snapshot;

    // Salary versions include exact effective dates and preserve earlier payroll.
    await request(`/employees/${employee}`, 'PUT', { basic: 60000 }, 400);
    assert.equal(Number((await request('/employees')).find((row) => row.id === employee).basic), 30000, 'Invalid salary update rolls back');
    await request(`/employees/${employee}`, 'PUT', { basic: 60000, salary_effective_from: '2026-02-30', salary_change_reason: 'Raise' }, 400);
    await request(`/employees/${employee}`, 'PUT', { basic: 60000, salary_effective_from: '2026-10-16', salary_change_reason: 'Annual salary revision' });
    const history = await request(`/employees/${employee}/salary-history`);
    assert.equal(history.length, 2); assert.equal(history[0].effective_from, '2026-10-16');
    assert.equal(history[0].reason, 'Annual salary revision');
    await request(`/employees/${employee}`, 'PUT', { basic: 62000, salary_effective_from: '2026-10-16', salary_change_reason: 'Duplicate date' }, 409);
    assert.equal(Number((await request('/employees')).find((row) => row.id === employee).basic), 60000);
    await request('/payslips/generate', 'POST', { ...payload, mode: 'update' }, 201);
    slip = await getSlip(employee, 9);
    assert.equal(Number(slip.basic), 15000, 'Historical regeneration uses the salary effective then');
    assert.deepEqual(slip.calculation_snapshot, oldSnapshot);
    const october = await request('/payslips/preview', 'POST', { ...payload, month: 10 });
    assert.equal(october.basic, 45483.87, 'Mid-month salary revision is weighted by daily salary');
    assert.equal(october.hra, 6000); assert.equal(october.gross, 51483.87);

    // Workflow, stale-data protection, correction reasons, locks and ownership.
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'finalized' }, 409);
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'reviewed' }, 403, employeeToken);
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'reviewed' });
    await request('/attendance/bulk', 'PUT', { work_date: '2026-09-18', records: [{ employee_id: employee, status: 'absent' }] });
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'finalized' }, 409);
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'draft' }, 400);
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'draft', reason: 'Correct attendance' });
    await request('/payslips/generate', 'POST', { ...payload, mode: 'update' }, 201);
    slip = await getSlip(employee, 9); assert.equal(Number(slip.net_pay), 13600);
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'reviewed' });
    const pending = (await pool.query(`INSERT INTO leaves (employee_id,leave_type,start_date,end_date,status)
      VALUES ($1,'casual','2026-09-21','2026-09-21','pending') RETURNING id`, [employee])).rows[0].id;
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'finalized' }, 409);
    await pool.query("UPDATE leaves SET status = 'rejected' WHERE id = $1", [pending]);
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'finalized' });
    await request('/payslips/generate', 'POST', { ...payload, mode: 'update' }, 409);
    await request(`/payslips/${slip.id}`, 'DELETE', null, 409);
    const unchanged = await getSlip(employee, 9); assert.equal(Number(unchanged.net_pay), 13600);
    assert.equal((await request('/payslips/generate', 'POST', payload, 201)).generated, 0);
    await request(`/payslips/${slip.id}/payment`, 'PATCH', { payment_status: 'paid', paid_on: '2100-01-01', payment_reference: 'BANK-1' }, 400);
    await request(`/payslips/${slip.id}/payment`, 'PATCH', { payment_status: 'paid', paid_on: '2026-09-30', payment_reference: '' }, 400);
    await request(`/payslips/${slip.id}/payment`, 'PATCH', { payment_status: 'paid', paid_on: '2026-09-30', payment_reference: 'BANK-1' });
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'draft', reason: 'Correction' }, 409);
    await request(`/payslips/${slip.id}/payment`, 'PATCH', { payment_status: 'unpaid' }, 400);
    const paidReport = await request('/reports?period=2026-09');
    assert.equal(paidReport.payslips.find((row) => row.id === slip.id).payment_status, 'paid');
    assert.ok(paidReport.payroll_audit.some((row) => row.action === 'payment_recorded'));
    const { buildReports } = await import('../../client/src/utils/reportData.js');
    const paymentSummary = buildReports(paidReport, { period: '2026-09' }).find((report) => report.id === 'payment-summary');
    assert.equal(paymentSummary.rows[0].paid_amount, 13600); assert.equal(paymentSummary.rows[0].paid_count, 1);
    await request(`/payslips/${slip.id}/events`, 'GET', null, 403, otherToken);
    const events = await request(`/payslips/${slip.id}/events`);
    assert.ok(events.some((row) => row.action === 'reopened' && row.reason === 'Correct attendance'));
    await request(`/payslips/${slip.id}/payment`, 'PATCH', { payment_status: 'unpaid', reason: 'Incorrect payment reference' });
    await request(`/payslips/${slip.id}/status`, 'PATCH', { status: 'draft', reason: 'Recalculate after reversal' });
    await request(`/payslips/${slip.id}`, 'DELETE');
    assert.ok((await pool.query("SELECT * FROM payroll_events WHERE action = 'deleted' AND employee_id = $1", [employee])).rows[0].before_snapshot, 'Deletion retains the previous payroll snapshot');

    // Exit proration, historical eligibility, leap years, excessive deductions and atomicity.
    const exited = (await pool.query(`INSERT INTO employees (emp_code,name,email,password_hash,basic,joining_date,resignation_date,is_active)
      VALUES ('E3','Exited employee','exit@test.invalid','unused',3000,'2020-01-01','2026-09-10',false) RETURNING id`)).rows[0].id;
    await request('/payslips/generate', 'POST', { employee_id: exited, month: 9, year: 2026 }, 201);
    assert.equal(Number((await getSlip(exited, 9)).net_pay), 1000);
    await request('/payslips/generate', 'POST', { employee_id: exited, month: 10, year: 2026 }, 400);
    assert.equal((await request('/payslips/preview', 'POST', { employee_id: other, month: 2, year: 2024 })).month_days, 29);
    await request('/payslips/generate', 'POST', { employee_id: other, month: 9, year: 2026, deductions: 10001 }, 400);
    assert.equal(await getSlip(other, 9), undefined, 'Negative-net payroll creates no record');
    await request('/payslips/generate', 'POST', { month: 8, year: 2026, deductions: 100000 }, 400);
    assert.equal((await request('/payslips?month=8&year=2026')).length, 0, 'Batch failure rolls back all rows');
    const highDeduction = await request('/payslips/generate', 'POST', { employee_id: other, month: 9, year: 2026, deductions: 6000 }, 201);
    assert.equal(highDeduction.warnings.length, 1);
    const highSlip = await getSlip(other, 9);
    await request(`/payslips/${highSlip.id}/status`, 'PATCH', { status: 'reviewed' });
    await request(`/payslips/${highSlip.id}/status`, 'PATCH', { status: 'finalized' }, 400);
    await request(`/payslips/${highSlip.id}/status`, 'PATCH', { status: 'finalized', acknowledge_warnings: true });
    const checklist = await request('/payslips/checklist?month=9&year=2026');
    assert.equal(checklist.summary.eligible, 3); assert.ok(checklist.summary.missing_attendance > 0);
    assert.equal(checklist.summary.finalized, 1);
    assert.match(checklist.note, /advisory/);
    assert.equal((await request('/payslips/checklist?month=1&year=2100')).summary.missing_attendance, 0, 'Future attendance gaps are not counted');
    await request(`/payslips/${highSlip.id}/payment`, 'PATCH', { payment_status: 'paid', paid_on: '2026-02-30', payment_reference: 'X' }, 400);

    // New employee versions and immediate token invalidation.
    const added = await request('/employees', 'POST', { emp_code: 'E4', name: 'New employee', email: 'new@test.invalid', password: 'test-password', designation: 'Developer', gender: 'female', dob: '2000-01-01', joining_date: '2026-10-01', basic: 10000 }, 201);
    assert.equal((await request(`/employees/${added.id}/salary-history`)).length, 1);

    // Signing in no longer marks attendance; the first check-in of the day is recorded in IST and cannot be moved.
    const loginBody = { email: 'new@test.invalid', password: 'test-password' };
    await request('/auth/login', 'POST', { ...loginBody, password: 'wrong' }, 401);
    await request('/auth/login', 'POST', loginBody);
    assert.equal((await pool.query('SELECT * FROM attendance WHERE employee_id = $1', [added.id])).rowCount, 0, 'sign-in does not mark attendance');
    await pool.query("UPDATE employees SET joining_date = '2020-01-01', must_change_password = FALSE WHERE id = $1", [added.id]);
    const addedToken = jwt.sign({ id: added.id, role: 'employee' }, secret);
    await request('/attendance/check-in', 'POST', null, 201, addedToken);
    const firstLogin = (await pool.query('SELECT check_in::text AS check_in, work_date::text AS work_date FROM attendance WHERE employee_id = $1', [added.id])).rows[0];
    assert.ok(firstLogin.check_in.startsWith(firstLogin.work_date));
    await request('/attendance/check-in', 'POST', null, 409, addedToken);
    assert.equal((await pool.query('SELECT check_in::text AS check_in FROM attendance WHERE employee_id = $1', [added.id])).rows[0].check_in, firstLogin.check_in);

    const lateEmployee = (await pool.query(`INSERT INTO employees (emp_code,name,email,password_hash,basic,hra,joining_date)
      VALUES ('E5','Late employee','late@test.invalid','unused',30000,6000,'2020-01-01') RETURNING id`)).rows[0].id;
    const lateInput = { employee_id: lateEmployee, month: 9, year: 2026, deductions: 100 };
    async function punch(day, time, status = 'present') {
      const workDate = `2026-09-${String(day).padStart(2, '0')}`;
      await pool.query(`INSERT INTO attendance (employee_id,work_date,status,check_in) VALUES ($1,$2,$3,$4)`,
        [lateEmployee, workDate, status, `${workDate} ${time}`]);
    }
    await punch(1, '09:09:59'); await punch(2, '09:10:00');
    await punch(3, '09:10:01'); await punch(4, '10:00:00');
    await punch(5, '10:00:00', 'paid_leave');
    const twoLate = await request('/payslips/preview', 'POST', lateInput);
    assert.equal(twoLate.late_login_count, 2); assert.equal(twoLate.late_login_deduction, 0);
    await punch(6, '09:11:00');
    const threeLate = await request('/payslips/preview', 'POST', lateInput);
    assert.equal(threeLate.late_login_count, 3); assert.equal(threeLate.late_login_deduction, 600);
    assert.equal(threeLate.deductions, 700); assert.equal(threeLate.net_pay, 35300);
    assert.equal(threeLate.net_paid_days, 29.5); assert.match(threeLate.late_login_reason, /after 9:10 AM IST.*3 days.*half-day/);
    await request('/payslips/generate', 'POST', lateInput, 201);
    const lateSlip = await getSlip(lateEmployee, 9);
    assert.equal(Number(lateSlip.net_pay), threeLate.net_pay);
    const lateToken = jwt.sign({ id: lateEmployee, role: 'employee' }, secret);
    assert.equal((await request('/payslips/my', 'GET', null, 200, lateToken)).length, 0, 'Unpublished payslips are hidden from employees');
    assert.equal((await fetch(`${base}/payslips/${lateSlip.id}/download`, { headers: { Authorization: `Bearer ${lateToken}` } })).status, 404, 'Unpublished PDF is hidden');
    await pool.query('UPDATE payslips SET published_at = NOW() WHERE published_at IS NULL');
    const myLateSlip = (await request('/payslips/my', 'GET', null, 200, lateToken))[0];
    assert.equal(Number(myLateSlip.late_login_deduction), 600);
    assert.equal(myLateSlip.late_login_reason, threeLate.late_login_reason);
    const pdf = await fetch(`${base}/payslips/${lateSlip.id}/download`, { headers: { Authorization: `Bearer ${lateToken}` } });
    assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /application\/pdf/);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    await request(`/payslips/${lateSlip.id}/status`, 'PATCH', { status: 'reviewed' });
    await punch(7, '09:30:00'); await punch(8, '09:30:00'); await punch(9, '09:30:00');
    await request(`/payslips/${lateSlip.id}/status`, 'PATCH', { status: 'finalized' }, 409);
    const sixLate = await request('/payslips/preview', 'POST', lateInput);
    assert.equal(sixLate.late_login_count, 6); assert.equal(sixLate.late_login_deduction, 600, 'One half-day deduction per month');
    assert.equal((await request('/payslips/preview', 'POST', { ...lateInput, month: 10 })).late_login_deduction, 0, 'Late count resets monthly');
    await request(`/employees/${other}`, 'DELETE');
    await request('/payslips/my', 'GET', null, 401, otherToken);
    await request('/payslips/my', 'GET', null, 200, employeeToken);
    await pool.query("UPDATE employees SET role = 'employee' WHERE id = $1", [administrator]);
    await request('/payslips', 'GET', null, 401, token);
    await pool.query(ddl);
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM salary_history WHERE employee_id = $1', [employee])).rows[0].count), 2, 'Rerunning the migration preserves salary history');
    console.log('Passed: date-based proration, leap years, effective salary versions, historical payroll, strict validation, preview/generation parity, atomic batches, review locks, correction audit, stale inputs, pending leave checks, payment/reversal history, deduction warnings, first daily login, late-login cutoff, monthly half-day deduction, deduction reasons, PDF download, checklist and immediate account access removal.');
  } finally {
    if (server) { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
    await pool.end();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
