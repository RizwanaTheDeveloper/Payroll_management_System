// Real API/database checks in a disposable schema; existing payroll data is untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../src/config/db');
const loanAmounts = require('../src/utils/loanAmounts');

async function main() {
  assert.deepEqual(loanAmounts('10000', '2', 10), {
    monthlyPrincipal: 1000, monthlyInterest: 200, instalment: 1200,
    interest: 2000, total: 12000,
  }, 'Flat monthly interest uses the original principal for all ten instalments');
  const schema = `loan_test_${process.pid}_${Date.now()}`;
  assert.match(schema, /^loan_test_\d+_\d+$/);
  const admin = new Client({ ...pool.options, connectionTimeoutMillis: 5000 });
  let server;
  let schemaCreated = false;
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    pool.options.options = `-c search_path=${schema}`;
    assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name, schema);
    await pool.query(fs.readFileSync(path.join(__dirname, '../src/schema.sql'), 'utf8'));
    const employee = (await pool.query(`INSERT INTO employees
      (emp_code,name,email,password_hash,role,basic,advance,joining_date)
      VALUES ('TEST-E','Test Employee','employee@test.invalid','unused','employee',1000,25,'2020-01-01') RETURNING id`)).rows[0].id;
    const administrator = (await pool.query(`INSERT INTO employees
      (emp_code,name,email,password_hash,role)
      VALUES ('TEST-A','Test Admin','admin@test.invalid','unused','admin') RETURNING id`)).rows[0].id;
    const secret = process.env.JWT_SECRET || 'isolated-integration-test-secret';
    process.env.JWT_SECRET = secret;
    const token = jwt.sign({ id: administrator, role: 'admin' }, secret);
    const employeeToken = jwt.sign({ id: employee, role: 'employee' }, secret);
    const otherEmployee = (await pool.query(`INSERT INTO employees
      (emp_code,name,email,password_hash,role)
      VALUES ('TEST-E2','Other Employee','other@test.invalid','unused','employee') RETURNING id`)).rows[0].id;
    const otherEmployeeToken = jwt.sign({ id: otherEmployee, role: 'employee' }, secret);
    const app = express();
    app.use(express.json());
    app.use('/loans', require('../src/routes/loans'));
    app.use('/payslips', require('../src/routes/payslips'));
    app.use((err, req, res, next) => { console.error(err.message); res.status(500).json({ message: err.message }); });
    server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(url, method = 'GET', body, expected = 200, auth = token) {
      const response = await fetch(`${base}${url}`, { method,
        headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(data)}`);
      return data;
    }
    await request('/loans', 'GET', null, 401, null);
    await request('/loans', 'GET', null, 403, employeeToken);
    const payload = { employee_id: employee, amount: '250.00', interest_percentage: '10.00', instalment: '100.00', first_recovery: '2020-01-01', reason: 'Integration test' };
    await request('/loans/my', 'GET', null, 403);
    await request('/loans', 'POST', payload, 403);
    await request('/loans', 'POST', { ...payload, instalment: '276' }, 400, employeeToken);
    await request('/loans', 'POST', { ...payload, amount: '1.001' }, 400, employeeToken);
    for (const interest_percentage of [-1, 101, '1.001', '', null, 'NaN']) {
      await request('/loans', 'POST', { ...payload, interest_percentage }, 400, employeeToken);
    }
    const { id } = await request('/loans', 'POST', { ...payload, employee_id: otherEmployee, status: 'approved' }, 201, employeeToken);
    const ownDetail = await request(`/loans/${id}`, 'GET', null, 200, employeeToken);
    assert.equal(ownDetail.employee_id, employee, 'Authenticated employee owns the request despite spoofed employee ID');
    assert.equal(ownDetail.created_by, employee);
    assert.equal(Number(ownDetail.interest_percentage), 10);
    assert.equal(Number(ownDetail.interest_amount), 25);
    assert.equal(ownDetail.monthly_interest_amount, null, 'Legacy one-time interest has no monthly interest amount');
    assert.equal(Number(ownDetail.total_repayable), 275);
    assert.equal(ownDetail.status, 'pending', 'Employees cannot select approved status');
    assert.equal((await request('/loans/my', 'GET', null, 200, employeeToken)).length, 1);
    assert.equal((await request('/loans/my', 'GET', null, 200, otherEmployeeToken)).length, 0);
    await request(`/loans/${id}`, 'GET', null, 404, otherEmployeeToken);
    for (const action of ['approve', 'reject', 'disburse', 'pause', 'resume']) {
      await request(`/loans/${id}/status`, 'PATCH', { action }, 403, employeeToken);
    }
    const decision = (action, extra = {}, status = 200) => request(`/loans/${id}/status`, 'PATCH', { action, ...extra }, status);
    const generate = (month, mode = 'generate') => request('/payslips/generate', 'POST', { employee_id: employee, month, year: 2020, mode }, 201);
    const get = () => request(`/loans/${id}`);
    const adminQueue = await request('/loans');
    assert.equal(adminQueue[0].id, id, 'Employee submission appears in admin register');
    assert.equal(adminQueue[0].status, 'pending', 'Submission waits for admin decision');
    assert.equal(adminQueue[0].employee_id, employee, 'Admin can select the submitting employee');
    await generate(1);
    assert.equal(Number((await get()).recovered), 0, 'Pending requests are not recovered');
    await decision('disburse', { disbursed_on: '2020-01-01', payment_reference: 'TEST-PAY' }, 409);
    await decision('approve');
    assert.equal((await request(`/loans/${id}`, 'GET', null, 200, employeeToken)).status, 'approved', 'Employee sees admin approval');
    await generate(1, 'update');
    assert.equal(Number((await get()).recovered), 100, 'Approved loans reduce salary without waiting for disbursement');
    const approvedSlip = (await request('/payslips'))[0];
    assert.equal(Number(approvedSlip.net_pay), 875, 'Approved loan instalment and salary advance reduce net pay');
    await pool.query('UPDATE payslips SET published_at = NOW() WHERE published_at IS NULL');
    const employeeSlips = await request('/payslips/my', 'GET', null, 200, employeeToken);
    assert.equal(employeeSlips[0].advance_recoveries[0].advance_id, id, 'Employee deduction list identifies the loan');
    assert.equal(Number(employeeSlips[0].advance_recoveries[0].amount), 100);
    const pdfResponse = await fetch(`${base}/payslips/${approvedSlip.id}/download`, { headers: { Authorization: `Bearer ${employeeToken}` } });
    assert.equal(pdfResponse.status, 200, 'Employee can download payslip containing the approved loan deduction');
    assert.equal(Buffer.from(await pdfResponse.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    await decision('disburse', { disbursed_on: '2020-01-01', payment_reference: 'TEST-PAY' });
    await decision('disburse', { disbursed_on: '2020-01-01', payment_reference: 'TEST-PAY' }, 409);
    await generate(1, 'update');
    let detail = await get();
    assert.equal(Number(detail.recovered), 100);
    let slips = await request('/payslips');
    assert.equal(Number(slips[0].advance), 125, 'Legacy plus managed recovery');
    assert.equal(Number(slips[0].net_pay), 875, 'Net pay reconciles');
    assert.equal(slips[0].advance_recoveries[0].advance_id, id);
    await Promise.all([generate(1, 'update'), generate(1, 'update')]);
    assert.equal(Number((await get()).recovered), 100, 'Concurrent updates do not double recover');
    await decision('pause', {}, 400);
    await decision('pause', { note: 'Temporary pause' });
    await generate(2);
    assert.equal(Number((await get()).recovered), 100, 'Paused advances excluded');
    await generate(1, 'update');
    assert.equal(Number((await get()).recovered), 100, 'Paused updates retain previous deduction');
    await decision('resume', { note: 'Recovery resumed' });
    await generate(2, 'update');
    await generate(3);
    detail = await get();
    assert.equal(Number(detail.recovered), 275);
    assert.equal(Number(detail.outstanding), 0);
    assert.equal(detail.status, 'completed');
    assert.equal(Number(detail.recoveries[2].amount), 75, 'Final instalment capped');
    slips = await request('/payslips');
    const finalSlip = slips.find((slip) => Number(slip.month) === 3);
    assert.equal(Number(finalSlip.advance), 75, 'Final deduction includes remaining principal and interest');
    assert.equal(Number(finalSlip.net_pay), 925, 'Interest reduces net salary');
    const register = await request('/loans');
    assert.equal(register[0].period_recoveries.length, 3, 'Summary includes recorded monthly recoveries');
    await generate(1, 'update');
    assert.equal(Number((await get()).recovered), 275, 'Completed advance retains historical deduction');
    await generate(4);
    assert.equal(Number((await get()).recovered), 275, 'No excess recovery');
    await request(`/payslips/${detail.recoveries[2].payslip_id}`, 'DELETE');
    assert.equal(Number((await get()).outstanding), 75, 'Deleting payslip restores balance');
    await generate(3);
    assert.equal(Number((await get()).outstanding), 0);
    const second = await request('/loans', 'POST', payload, 201, employeeToken);
    assert.equal((await request('/loans'))[0].id, second.id, 'Pending requests appear before processed advances');
    await request(`/loans/${second.id}/status`, 'PATCH', { action: 'reject' }, 400);
    await request(`/loans/${second.id}/status`, 'PATCH', { action: 'reject', note: 'Not eligible' });
    assert.equal((await request(`/loans/${second.id}`)).status, 'rejected');
    const rejectedHistory = (await request(`/loans/${second.id}`)).events;
    assert.equal(rejectedHistory[0].action, 'reject', 'Admin history includes rejection decision');
    assert.equal(rejectedHistory[0].note, 'Not eligible', 'Admin history preserves rejection reason');
    assert.equal(rejectedHistory[0].actor, 'Test Admin', 'History identifies rejecting reviewer');
    assert.ok(Number.isFinite(Date.parse(rejectedHistory[0].created_at)), 'History includes decision time');
    assert.equal(rejectedHistory[1].action, 'created', 'Rejection keeps submission history');
    assert.equal((await request(`/loans/${second.id}`, 'GET', null, 200, employeeToken)).events[0].note, 'Not eligible', 'Employee sees rejection reason');
    await request(`/loans/${second.id}/status`, 'PATCH', { action: 'approve' }, 409);
    const otherRequest = await request('/loans', 'POST', payload, 201, otherEmployeeToken);
    const multiEmployeeRegister = await request('/loans');
    assert.equal(multiEmployeeRegister.find((advance) => advance.id === otherRequest.id).employee_id, otherEmployee, 'Register distinguishes selectable employees');
    assert.equal((await request(`/loans/${otherRequest.id}`)).name, 'Other Employee', 'Selecting another request loads its employee details');
    await pool.query('UPDATE employees SET is_active = FALSE WHERE id = $1', [otherEmployee]);
    await request('/loans', 'POST', payload, 401, otherEmployeeToken);
    assert.equal(detail.events.length, 5, 'Creation and decisions audited');
    await pool.query('UPDATE employees SET is_active = TRUE WHERE id = $1', [otherEmployee]);
    const rounded = await request('/loans', 'POST', { ...payload, amount: '1.01', interest_percentage: '50', instalment: '1.52' }, 201, otherEmployeeToken);
    const roundedDetail = await request(`/loans/${rounded.id}`);
    assert.equal(Number(roundedDetail.interest_amount), 0.51, 'Half-paise interest rounds up');
    assert.equal(Number(roundedDetail.total_repayable), 1.52, 'Full repayment instalment may exceed principal');
    const zeroInterest = await request('/loans', 'POST', { ...payload, interest_percentage: 0 }, 201, otherEmployeeToken);
    assert.equal(Number((await request(`/loans/${zeroInterest.id}`)).total_repayable), 250, 'Zero-interest loans retain principal-only repayment');
    // Monthly flat interest: the user's 10,000 / 10 months / 2% example.
    for (const instalment_count of [0, -1, 361, '1.5', '', null]) {
      await request('/loans', 'POST', { ...payload, instalment_count }, 400, otherEmployeeToken);
    }
    await pool.query('UPDATE employees SET basic = 2000, advance = 0 WHERE id = $1', [otherEmployee]);
    const monthlyLoan = await request('/loans', 'POST', { ...payload, amount: '10000',
      interest_percentage: '2', instalment_count: 10, instalment: '1', first_recovery: '2021-01-01' }, 201, otherEmployeeToken);
    let monthlyDetail = await request(`/loans/${monthlyLoan.id}`);
    assert.equal(Number(monthlyDetail.interest_amount), 2000);
    assert.equal(Number(monthlyDetail.monthly_interest_amount), 200, 'Monthly interest amount is exposed in loan details');
    assert.equal(Number(monthlyDetail.total_repayable), 12000);
    assert.equal(Number(monthlyDetail.instalment), 1200, 'Server calculates deduction despite submitted instalment');
    assert.equal(monthlyDetail.instalment_count, 10);
    await request(`/loans/${monthlyLoan.id}/status`, 'PATCH', { action: 'approve' });
    await request(`/loans/${monthlyLoan.id}/status`, 'PATCH', { action: 'disburse', disbursed_on: '2021-01-01', payment_reference: 'MONTHLY-TEST' });
    for (let month = 1; month <= 11; month++) {
      await request('/payslips/generate', 'POST', { employee_id: otherEmployee, month, year: 2021 }, 201);
      const slip = (await request('/payslips')).find((p) => p.employee_id === otherEmployee && Number(p.month) === month && Number(p.year) === 2021);
      assert.equal(Number(slip.advance), month <= 10 ? 1200 : 0, 'Same deduction for ten months only');
      assert.equal(Number(slip.net_pay), month <= 10 ? 800 : 2000, 'Monthly deduction reduces net salary');
    }
    monthlyDetail = await request(`/loans/${monthlyLoan.id}`);
    assert.equal(monthlyDetail.recoveries.length, 10);
    assert.equal(Number(monthlyDetail.recovered), 12000);
    assert.equal(Number(monthlyDetail.outstanding), 0);
    assert.equal(monthlyDetail.status, 'completed');
    // Principal division rounds down to paise; final deduction collects the remainder.
    const fractionalLoan = await request('/loans', 'POST', { ...payload, amount: '1.01',
      interest_percentage: '2', instalment_count: 3, first_recovery: '2022-01-01' }, 201, otherEmployeeToken);
    await request(`/loans/${fractionalLoan.id}/status`, 'PATCH', { action: 'approve' });
    await request('/payslips/generate', 'POST', { employee_id: otherEmployee, month: 12, year: 2021 }, 201);
    assert.equal(Number((await request(`/loans/${fractionalLoan.id}`)).recovered), 0, 'Approved loan waits for its first recovery month');
    for (let month = 1; month <= 3; month++) {
      await request('/payslips/generate', 'POST', { employee_id: otherEmployee, month, year: 2022 }, 201);
    }
    const fractionalDetail = await request(`/loans/${fractionalLoan.id}`);
    assert.deepEqual(fractionalDetail.recoveries.map((r) => Number(r.amount)), [0.35, 0.35, 0.37]);
    assert.equal(Number(fractionalDetail.total_repayable), 1.07);
    assert.equal(Number(fractionalDetail.outstanding), 0);
    assert.equal(fractionalDetail.status, 'completed', 'Approved loans become completed when fully recovered');
    await request('/payslips/generate', 'POST', { employee_id: otherEmployee, month: 4, year: 2022 }, 201);
    assert.equal(Number((await request(`/loans/${fractionalLoan.id}`)).recovered), 1.07, 'Completed approved loans are not deducted again');
    console.log('Passed: monthly flat interest, ten equal salary deductions, repayment completion, count validation and final rounding remainder.');
    console.log('Passed: employee-only requests, admin creation blocked, own-record access, spoofed employee/status protection, inactive employee restriction, validation, approval, disbursement, pause/resume, payroll reconciliation, concurrency, capped recovery, update/delete behavior, linked deductions and audit history.');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
    if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}
main().catch((err) => { console.error(err.message); process.exitCode = 1; });
