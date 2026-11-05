// Verify salary advances in an isolated schema; existing data is untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Client } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../src/config/db');

async function main() {
  const schema = `advance_test_${process.pid}_${Date.now()}`;
  assert.match(schema, /^advance_test_\d+_\d+$/);
  const database = new Client({ ...pool.options, connectionTimeoutMillis: 5000 });
  let server, created = false;
  try {
    await database.connect();
    await database.query(`CREATE SCHEMA "${schema}"`); created = true;
    pool.options.options = `-c search_path=${schema}`;
    await pool.query(fs.readFileSync(path.join(__dirname, '../src/schema.sql'), 'utf8'));
    const employee = (await pool.query(`INSERT INTO employees (emp_code,name,email,password_hash,role,basic,joining_date)
      VALUES ('E1','Employee One','one@test.invalid','unused','employee',1000,'2020-01-01') RETURNING id`)).rows[0].id;
    const other = (await pool.query(`INSERT INTO employees (emp_code,name,email,password_hash,role,basic,joining_date)
      VALUES ('E2','Employee Two','two@test.invalid','unused','employee',1000,'2020-01-01') RETURNING id`)).rows[0].id;
    const inactive = (await pool.query(`INSERT INTO employees (emp_code,name,email,password_hash,role,is_active)
      VALUES ('E3','Inactive','inactive@test.invalid','unused','employee',false) RETURNING id`)).rows[0].id;
    const administrator = (await pool.query(`INSERT INTO employees (emp_code,name,email,password_hash,role)
      VALUES ('A1','Admin','admin@test.invalid','unused','admin') RETURNING id`)).rows[0].id;
    const secret = process.env.JWT_SECRET || 'isolated-advance-test-secret'; process.env.JWT_SECRET = secret;
    const token = jwt.sign({ id: administrator, role: 'admin' }, secret);
    const employeeToken = jwt.sign({ id: employee, role: 'employee' }, secret);
    const otherToken = jwt.sign({ id: other, role: 'employee' }, secret);
    const inactiveToken = jwt.sign({ id: inactive, role: 'employee' }, secret);
    const app = express(); app.use(express.json());
    app.use('/advances', require('../src/routes/advances'));
    app.use('/loans', require('../src/routes/loans'));
    app.use('/payslips', require('../src/routes/payslips'));
    app.use('/reports', require('../src/routes/reports'));
    app.use((err, req, res, next) => res.status(500).json({ message: err.message }));
    server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(url, method = 'GET', body, expected = 200, auth = token) {
      const response = await fetch(`${base}${url}`, { method,
        headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(data)}`); return data;
    }
    const payload = { amount: '250.50', first_recovery: '2026-09-01', reason: 'Salary advance request' };
    const deductionUtils = await import(pathToFileURL(path.resolve(__dirname, '../../client/src/utils/payrollDeductions.js')).href);
    await request('/advances', 'GET', null, 401, null);
    await request('/advances', 'GET', null, 403, employeeToken);
    await request('/advances/employees', 'GET', null, 403, employeeToken);
    const register = await request('/advances/employees');
    assert.equal(register.length, 3, 'All employees including inactive appear; admins do not');
    assert.ok(register.every((row) => Number(row.advance) === 0 && !('password_hash' in row)));
    for (const amount of ['', 0, -1, '1.001', null, 'NaN']) {
      await request('/advances', 'POST', { ...payload, amount }, 400, employeeToken);
    }
    for (const reason of [123, {}, [], 'x'.repeat(2001)]) {
      await request('/advances', 'POST', { ...payload, reason }, 400, employeeToken);
    }
    await request('/advances', 'POST', { ...payload, first_recovery: '2026-02-30' }, 400, employeeToken);
    await request('/advances', 'POST', { ...payload, first_recovery: '2026-09-02' }, 400, employeeToken);
    await request('/advances', 'POST', payload, 400);
    await request('/advances', 'POST', { ...payload, employee_id: inactive }, 403);
    await request('/advances', 'POST', { ...payload, employee_id: administrator }, 403);
    await request('/advances', 'POST', payload, 401, inactiveToken);
    const advance = await request('/advances', 'POST', { ...payload, employee_id: other, status: 'approved',
      record_type: 'loan', interest_percentage: 99, instalment_count: 10 }, 201, employeeToken);
    const get = () => request(`/advances/${advance.id}`);
    let detail = await get();
    assert.deepEqual(deductionUtils.scheduledLoanDeductions([detail], employee, '2026-09'), [], 'Pending advances are excluded from payroll preview');
    assert.equal(detail.employee_id, employee, 'Employees cannot request for someone else');
    assert.equal(detail.record_type, 'salary_advance'); assert.equal(detail.status, 'pending');
    assert.equal(Number(detail.interest_percentage), 0); assert.equal(detail.instalment_count, 1);
    assert.equal(Number(detail.instalment), 250.50); assert.equal(detail.created_by, employee);
    assert.equal((await request('/advances/my', 'GET', null, 200, otherToken)).length, 0);
    await request(`/advances/${advance.id}`, 'GET', null, 404, otherToken);
    await request(`/advances/${advance.id}/status`, 'PATCH', { action: 'approve' }, 403, employeeToken);
    assert.equal((await request('/loans')).length, 0, 'Salary advances are not listed as loans');
    await request(`/loans/${advance.id}`, 'GET', null, 404);
    await request(`/loans/${advance.id}/status`, 'PATCH', { action: 'approve' }, 404);
    const loan = await request('/loans', 'POST', { ...payload, amount: '100', instalment_count: 1, interest_percentage: 2 }, 201, employeeToken);
    await request(`/advances/${loan.id}`, 'GET', null, 404);
    await request(`/advances/${loan.id}/status`, 'PATCH', { action: 'approve' }, 404);
    await request('/payslips/generate', 'POST', { employee_id: employee, month: 9, year: 2026 }, 201);
    assert.equal(Number((await get()).recovered), 0, 'Pending advances do not reduce salary');
    await request(`/advances/${advance.id}/status`, 'PATCH', { action: 'approve', note: 'Accepted' });
    await request(`/advances/${advance.id}/status`, 'PATCH', { action: 'approve' }, 409);
    const approved = (await request('/advances/employees')).find((row) => row.employee_id === employee);
    assert.equal(Number(approved.advance), 250.50); assert.equal(Number(approved.pending_advance), 0);
    const previewAdvance = await get();
    assert.deepEqual(deductionUtils.scheduledLoanDeductions([previewAdvance], employee, '2026-08'), [], 'Advance waits for recovery month');
    assert.deepEqual(deductionUtils.scheduledLoanDeductions([previewAdvance], employee, '2026-09'),
      [{ advance_id: advance.id, amount: 250.50, record_type: 'salary_advance' }], 'Payroll preview matches saved advance deduction');
    await Promise.all([1, 2].map(() => request('/payslips/generate', 'POST',
      { employee_id: employee, month: 9, year: 2026, mode: 'update' }, 201)));
    detail = await get(); assert.equal(detail.status, 'completed');
    assert.equal(Number(detail.recovered), 250.50); assert.equal(Number(detail.outstanding), 0);
    let slip = (await request('/payslips')).find((row) => row.employee_id === employee);
    assert.equal(Number(slip.advance), 250.50); assert.equal(Number(slip.net_pay), 749.50);
    assert.equal(slip.advance_recoveries[0].record_type, 'salary_advance');
    assert.equal(deductionUtils.loanDeductionItems(slip)[0].label, `Salary advance ADV-${advance.id}`);
    assert.equal(deductionUtils.loanDeductionItems(slip)[0].href, `/admin/advances?advance=${advance.id}`);
    const data = await request('/reports?period=2026-09');
    const reported = data.payslips.find((row) => row.employee_id === employee && row.month === 9);
    assert.equal(Number(reported.loan_recovery), 0, 'Advance deductions do not appear as loan deductions');
    const reportUtils = await import(pathToFileURL(path.resolve(__dirname, '../../client/src/utils/reportData.js')).href);
    const reports = reportUtils.buildReports(data, { period: '2026-09' });
    const advanceReport = reports.find((report) => report.id === 'advance-deductions');
    assert.equal(Number(advanceReport.rows.find((row) => row.employee_id === employee).salary_advance), 250.50);
    await pool.query('UPDATE payslips SET published_at = NOW() WHERE published_at IS NULL');
    const pdf = await fetch(`${base}/payslips/${slip.id}/download`, { headers: { Authorization: `Bearer ${employeeToken}` } });
    assert.equal(pdf.status, 200); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    await request(`/payslips/${slip.id}`, 'DELETE');
    assert.equal(Number((await get()).outstanding), 250.50, 'Deleting payroll restores advance balance');
    await request('/payslips/generate', 'POST', { employee_id: employee, month: 9, year: 2026 }, 201);
    await request('/payslips/generate', 'POST', { employee_id: employee, month: 10, year: 2026 }, 201);
    const nextSlip = (await request('/payslips')).find((row) => row.employee_id === employee && row.month === 10);
    assert.equal(Number(nextSlip.advance), 0, 'Advance is deducted only once');
    const adminAdded = await request('/advances', 'POST', { ...payload, employee_id: other, status: 'pending' }, 201);
    assert.equal(adminAdded.status, 'approved', 'Admin-entered advances are approved during creation');
    const adminDetail = await request(`/advances/${adminAdded.id}`);
    assert.equal(adminDetail.employee_id, other); assert.equal(adminDetail.created_by, administrator);
    assert.equal(adminDetail.status, 'approved');
    assert.deepEqual(adminDetail.events.map((entry) => entry.action), ['approve', 'created'], 'Creation and approval are both recorded');
    assert.match(adminDetail.events[0].note, /entered directly by administrator/);
    const employeeView = (await request('/advances/my', 'GET', null, 200, otherToken))[0];
    assert.equal(employeeView.id, adminAdded.id); assert.equal(employeeView.status, 'approved');
    const directBalance = (await request('/advances/employees')).find((row) => row.employee_id === other);
    assert.equal(Number(directBalance.advance), 250.50); assert.equal(Number(directBalance.pending_advance), 0);
    await request(`/advances/${adminAdded.id}/status`, 'PATCH', { action: 'approve' }, 409);
    const employeeRequest = await request('/advances', 'POST', payload, 201, otherToken);
    assert.equal(employeeRequest.status, 'pending');
    await request(`/advances/${employeeRequest.id}/status`, 'PATCH', { action: 'reject' }, 400);
    await request(`/advances/${employeeRequest.id}/status`, 'PATCH', { action: 'reject', note: '   ' }, 400);
    await request(`/advances/${employeeRequest.id}/status`, 'PATCH', { action: 'reject', note: '  Budget not available  ' });
    const rejected = await request(`/advances/${employeeRequest.id}`, 'GET', null, 200, otherToken);
    assert.equal(rejected.status, 'rejected'); assert.equal(rejected.events[0].note, 'Budget not available');
    await request('/payslips/generate', 'POST', { employee_id: other, month: 9, year: 2026 }, 201);
    assert.equal(Number((await request(`/advances/${adminAdded.id}`)).recovered), 250.50, 'Admin-entered advance is eligible for payroll without a separate approval');
    assert.equal(Number((await request(`/advances/${employeeRequest.id}`)).recovered), 0);
    const directSlip = (await request('/payslips')).find((row) => row.employee_id === other && row.month === 9);
    assert.equal(Number(directSlip.net_pay), 749.50);
    for (const auth of [token, employeeToken]) {
      for (const reason of [undefined, null, '', '   ']) {
        const added = await request('/advances', 'POST', { ...payload, employee_id: employee, reason }, 201, auth);
        const saved = await request(`/advances/${added.id}`);
        assert.equal(saved.reason, '', 'Advances can be saved without a reason');
        assert.equal(saved.events.find((entry) => entry.action === 'created').note, '');
      }
    }
    await request('/loans', 'POST', { ...payload, amount: '100', instalment_count: 1, reason: '' }, 400, employeeToken);
    console.log('Passed: all employee register, direct admin advances without separate approval, optional advance reasons, employee requests, ownership, loan separation, zero interest, approval, required rejection reasons, payroll recovery, repeated/concurrent saves, deletion, payslip labels/PDF and advance reporting.');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
    if (created) await database.query(`DROP SCHEMA "${schema}" CASCADE`);
    await database.end();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
