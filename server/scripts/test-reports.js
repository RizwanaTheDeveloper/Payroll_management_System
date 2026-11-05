// Verify the reporting API and client calculations against isolated real records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Client } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../src/config/db');

async function main() {
  const { buildReports, reportCsv, reportPreview } = await import(pathToFileURL(path.resolve(__dirname, '../../client/src/utils/reportData.js')));
  const schema = `report_test_${process.pid}_${Date.now()}`;
  assert.match(schema, /^report_test_\d+_\d+$/);
  const admin = new Client({ ...pool.options, connectionTimeoutMillis: 5000 });
  let server, schemaCreated = false;
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    pool.options.options = `-c search_path=${schema}`;
    await pool.query(fs.readFileSync(path.join(__dirname, '../src/schema.sql'), 'utf8'));
    const employee = (await pool.query(`INSERT INTO employees
      (emp_code,name,email,password_hash,role,department,designation,basic,joining_date)
      VALUES ('TEST-E','Employee A','employee@test.invalid','unused','employee','IT','Developer',25000,'2020-01-01') RETURNING id`)).rows[0].id;
    const administrator = (await pool.query(`INSERT INTO employees
      (emp_code,name,email,password_hash,role)
      VALUES ('TEST-A','Admin','admin@test.invalid','unused','admin') RETURNING id`)).rows[0].id;
    const newJoiner = (await pool.query(`INSERT INTO employees
      (emp_code,name,email,password_hash,role,department,joining_date)
      VALUES ('TEST-E2','=Formula','second@test.invalid','unused','employee','HR','2026-09-10') RETURNING id`)).rows[0].id;
    await pool.query(`INSERT INTO employees (emp_code,name,email,password_hash,department,joining_date,resignation_date,is_active)
      VALUES ('TEST-E3','Exit','exit@test.invalid','unused','HR','2020-01-01','2026-09-20',false),
      ('TEST-E4','Future','future@test.invalid','unused','IT','2026-10-01',NULL,true)`);
    const septemberSlip = (await pool.query(`INSERT INTO payslips
      (employee_id,month,year,basic,hra,epf,professional_tax,deductions,net_pay)
      VALUES ($1,9,2026,25000,8000,1800,200,1500,29500) RETURNING id`, [employee])).rows[0].id;
    await pool.query(`INSERT INTO payslips (employee_id,month,year,basic,net_pay)
      VALUES ($1,8,2026,30000,30000),($1,10,2026,40000,40000)`, [employee]);
    await pool.query(`INSERT INTO attendance (employee_id,work_date,status,check_in,check_out,day_type)
      VALUES ($1,'2026-09-01','leave',NULL,NULL,'full'),($1,'2026-09-02','paid_leave',NULL,NULL,'full'),
      ($1,'2026-09-03','leave',NULL,NULL,'full'),($1,'2026-09-04','present','2026-09-04 09:00','2026-09-04 18:00','full'),
      ($1,'2026-09-05','present','2026-09-05 09:00',NULL,'half'),
      ($1,'2026-09-06','present','2026-09-06 18:00','2026-09-06 09:00','full'),
      ($1,'2026-10-01','present',NULL,NULL,'full')`, [employee]);
    await pool.query(`INSERT INTO leaves (employee_id,leave_type,start_date,end_date,reason,status)
      VALUES ($1,'casual','2026-08-30','2026-09-03','Spanning request','approved'),
      ($1,'sick','2026-09-10','2026-09-11','Pending','pending'),
      ($1,'paid','2026-09-12','2026-09-12','Rejected','rejected')`, [employee]);
    const loan = (await pool.query(`INSERT INTO advances
      (employee_id,amount,instalment,first_recovery,reason,status,interest_percentage,instalment_count,created_at)
      VALUES ($1,10000,1200,'2026-08-01','Test','approved',2,10,'2026-08-01') RETURNING id`, [employee])).rows[0].id;
    await pool.query(`INSERT INTO advance_recoveries (advance_id,payslip_id,amount)
      SELECT $1,id,1200 FROM payslips WHERE employee_id=$2`, [loan, employee]);
    await pool.query(`UPDATE payslips SET advance=1200,net_pay=net_pay-1200 WHERE employee_id=$1`, [employee]);
    await pool.query(`INSERT INTO advance_events (advance_id,actor_id,action,note,created_at)
      VALUES ($1,$2,'approved','Test approval','2026-09-15'),($1,$2,'requested','Earlier request','2026-08-01')`, [loan, administrator]);
    const secret = process.env.JWT_SECRET || 'isolated-report-test-secret';
    process.env.JWT_SECRET = secret;
    const token = jwt.sign({ id: administrator, role: 'admin' }, secret);
    const employeeToken = jwt.sign({ id: employee, role: 'employee' }, secret);
    const app = express();
    app.use('/reports', require('../src/routes/reports'));
    app.use((err, req, res, next) => res.status(500).json({ message: err.message }));
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    async function request(query, auth = token, expected = 200) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/reports${query}`, {
        headers: auth ? { Authorization: `Bearer ${auth}` } : {},
      });
      const data = await response.json();
      assert.equal(response.status, expected, JSON.stringify(data));
      return data;
    }
    await request('?period=2026-09', null, 401);
    await request('?period=2026-09', employeeToken, 403);
    for (const query of ['', '?period=2026-13', '?period=2026-00', '?period=1900-01', '?period=2026-09%27']) {
      await request(query, token, 400);
    }
    const data = await request('?period=2026-09');
    assert.equal(data.payslips.length, 2, 'Only selected and previous month salaries are returned');
    assert.equal(data.employees.length, 4, 'Administrators are excluded');
    assert.ok(data.employees.every((e) => !('password_hash' in e) && !('account_number' in e)), 'No sensitive employee fields');
    assert.equal(data.attendance.length, 6);
    assert.equal(data.attendance[2].status, 'absent', 'Third leave day is unpaid');
    assert.equal(data.leaves[0].period_days, 3, 'Cross-month requests are clipped');
    assert.equal(Number(data.loans[0].recovered), 2400, 'Future repayments are excluded');
    assert.equal(Number(data.loans[0].period_recovered), 1200);
    assert.equal(data.audit.length, 1);
    const reports = buildReports(data, { period: '2026-09' });
    const report = (id) => reports.find((r) => r.id === id);
    assert.deepEqual(report('monthly-payroll').rows[0], { employees: 1, gross: 33000, total_deductions: 4700, net: 28300 });
    assert.equal(report('register').rows[0].total_allowances, 8000);
    assert.equal(report('variance').rows[0].difference, 3000);
    assert.equal(report('variance').rows[0].change, 10);
    assert.match(reportPreview(report('register')), /Net pay:.*28,300/);
    assert.deepEqual(report('attendance-summary').rows[0], { present: 2.5, unpaid: 1, leave: 2, worked: 9, missing: 1 });
    assert.equal(report('worked-hours').rows[0].invalid, 1);
    assert.equal(report('balance').rows.find((r) => r.id === employee).balance, 0);
    const utilization = report('utilization').rows.find((r) => r.id === employee);
    assert.deepEqual([utilization.requested, utilization.approved, utilization.pending, utilization.rejected], [6, 3, 2, 1]);
    assert.equal(report('deduction-summary').rows[0].loan_recovery, '1200.00');
    assert.equal(report('deduction-summary').rows[0].salary_advance, 0);
    assert.deepEqual(report('headcount').rows[0], { opening: 2, joiners: 1, exits: 1, closing: 2 });
    assert.equal(report('employee-register').rows.length, 3);
    assert.equal(report('payslip-summary').rows[0].pending, 2);
    assert.equal(report('loan-register').rows[0].outstanding, 9600);
    assert.equal(report('loan-summary').rows[0].recovered, 1200);
    assert.equal(report('loan-audit').rows[0].actor, 'Admin');
    assert.ok(report('esi').unavailable && !report('payment-summary').unavailable);
    const filtered = buildReports(data, { period: '2026-09', department: 'HR', employeeId: String(newJoiner) });
    assert.equal(filtered.find((r) => r.id === 'register').rows.length, 0);
    assert.equal(filtered.find((r) => r.id === 'employee-register').rows.length, 1);
    const csv = reportCsv(filtered.find((r) => r.id === 'employee-register'), { Period: 'September 2026' });
    assert.match(csv, /"'=Formula"/, 'CSV neutralizes formula text');
    const empty = buildReports({}, { period: '2026-01' });
    assert.equal(empty.find((r) => r.id === 'payroll-analytics').rows[0].average, 0);
    const rollover = buildReports({ ...data, payslips: [
      { employee_id: employee, year: 2025, month: 12, basic: 100 },
      { employee_id: employee, year: 2026, month: 1, basic: 110 },
    ] }, { period: '2026-01' });
    assert.equal(rollover.find((r) => r.id === 'variance').rows[0].change, 10);
    const { buildEmployeeSummaries, employeeDetailReports, employeeReportCsv } = await import(
      pathToFileURL(path.resolve(__dirname, '../../client/src/utils/employeeReportData.js')).href);
    const summaries = buildEmployeeSummaries(data, '2026-09');
    assert.equal(summaries.length, 4, 'Employee overview includes every employee');
    const individual = summaries.find((row) => row.employee_id === employee);
    assert.equal(individual.emp_code, 'TEST-E'); assert.equal(individual.name, 'Employee A');
    assert.deepEqual([individual.attendance_records, individual.present, individual.paid_leave, individual.unpaid,
      individual.worked_hours, individual.missing_punches, individual.invalid_punches], [6, 2.5, 2, 1, 9, 1, 1]);
    assert.deepEqual([individual.leave_requests, individual.approved_leave_requests, individual.pending_leave_requests,
      individual.rejected_leave_requests], [3, 1, 1, 1], 'Request counts differ from requested day counts');
    assert.deepEqual([individual.requested_days, individual.approved_days, individual.pending_days, individual.rejected_days], [6, 3, 2, 1]);
    assert.equal(individual.paid_balance, 0); assert.equal(Number(individual.net_pay), 28300);
    assert.equal(Number(individual.total_deductions), 4700); assert.equal(individual.loan_balance, 9600);
    assert.equal(individual.advance_balance, 0); assert.equal(individual.loan_requests, 1);
    assert.equal(individual.approved_loans, 1); assert.equal(individual.completed_loans, 0);
    const withoutRecords = summaries.find((row) => row.employee_id === newJoiner);
    assert.equal(withoutRecords.present, 0); assert.equal(withoutRecords.net_pay, null, 'Missing payroll is not zero pay');
    assert.equal(withoutRecords.payroll_status, 'Not generated'); assert.equal(withoutRecords.paid_balance, 2);
    const future = summaries.find((row) => row.name === 'Future');
    assert.equal(future.payroll_status, 'Outside employment period'); assert.equal(future.paid_allowance, null);
    const individualDetails = employeeDetailReports(data, '2026-09', employee);
    assert.equal(individualDetails.find((r) => r.id === 'attendance').rows.length, 6);
    assert.equal(individualDetails.find((r) => r.id === 'leaves').rows.length, 3);
    assert.equal(individualDetails.find((r) => r.id === 'loans').rows[0].outstanding, 9600);
    assert.ok(individualDetails.every((r) => r.rows.every((row) => row.employee_id === employee)), 'No other employee appears in individual details');
    const individualCsv = employeeReportCsv(individual, individualDetails, { Period: 'September 2026' });
    assert.match(individualCsv, /Individual employee report/); assert.match(individualCsv, /Daily attendance/);
    assert.match(individualCsv, /Employee A/); assert.match(individualCsv, /Approved leave requests/);
    assert.match(employeeReportCsv(withoutRecords, [], {}), /"'=Formula"/, 'Individual CSV neutralizes spreadsheet formulas');
    assert.deepEqual(buildEmployeeSummaries(null, '2026-09'), []);
    const mixed = buildEmployeeSummaries({ ...data, loans: [...data.loans,
      { id: 999, employee_id: employee, record_type: 'salary_advance', amount: '500', total_repayable: '500', recovered: '100', status: 'approved' },
      { id: 1000, employee_id: employee, record_type: 'salary_advance', amount: '700', total_repayable: '700', recovered: 0, status: 'pending' },
      { id: 1001, employee_id: employee, record_type: 'salary_advance', amount: '300', total_repayable: '300', recovered: 0, status: 'rejected' }
    ] }, '2026-09').find((row) => row.employee_id === employee);
    assert.equal(mixed.advance_balance, 400, 'Pending and rejected advances are excluded from approved balances');
    assert.equal(mixed.pending_advances, 1); assert.equal(mixed.rejected_advances, 1);
    assert.equal(mixed.advance_requests, 3); assert.equal(mixed.loan_balance, 9600);
    assert.equal(mixed.approved_advances, 1); assert.equal(mixed.completed_advances, 0);
    console.log('Passed: individual employee summaries, attendance and leave counts, payroll and credit balances, missing records, employment boundaries, employee-only detail rows and full CSV exports.');
    // The self-report endpoint must scope every source in SQL, even with spoofed query IDs.
    await pool.query(`INSERT INTO payslips (employee_id,month,year,basic,net_pay)
      VALUES ($1,9,2026,12345,12345)`, [newJoiner]);
    await pool.query(`INSERT INTO attendance (employee_id,work_date,status) VALUES ($1,'2026-09-21','present')`, [newJoiner]);
    await pool.query(`INSERT INTO leaves (employee_id,leave_type,start_date,end_date,reason)
      VALUES ($1,'casual','2026-09-22','2026-09-22','Private coworker leave')`, [newJoiner]);
    const privateLoan = (await pool.query(`INSERT INTO advances (employee_id,amount,instalment,first_recovery,reason,created_at)
      VALUES ($1,1234,1234,'2026-09-01','Private coworker loan','2026-09-01') RETURNING id`, [newJoiner])).rows[0].id;
    await pool.query(`INSERT INTO advance_events (advance_id,actor_id,action,note,created_at)
      VALUES ($1,$2,'created','Private coworker activity','2026-09-01')`, [privateLoan, administrator]);
    await pool.query(`INSERT INTO payroll_events (employee_id,month,year,actor_id,action,reason)
      VALUES ($1,9,2026,$3,'reviewed','Private coworker payroll'),($2,9,2026,$3,'reviewed','Own payroll review')`, [newJoiner, employee, administrator]);
    await pool.query('UPDATE payslips SET published_at = NOW() WHERE published_at IS NULL');
    await request('/my?period=2026-09', null, 401);
    await request('/my?period=2026-09', token, 403);
    await request('/my?period=2026-13', employeeToken, 400);
    for (const suffix of ['', `&employee_id=${newJoiner}`, `&employeeId=${newJoiner}&id=${newJoiner}&all=true`]) {
      const own = await request(`/my?period=2026-09${suffix}`, employeeToken);
      assert.equal(own.employees.length, 1); assert.equal(own.employees[0].id, employee);
      for (const key of ['payslips', 'attendance', 'leaves', 'loans', 'audit', 'payroll_audit']) {
        assert.ok(own[key].length > 0, `${key} includes own records`);
        assert.ok(own[key].every((row) => row.employee_id === employee), `${key} excludes coworkers at the API boundary`);
      }
      assert.ok(!JSON.stringify(own).includes('Private coworker'));
      const ownSummaries = buildEmployeeSummaries(own, '2026-09');
      assert.equal(ownSummaries.length, 1);
      const ownCsv = employeeReportCsv(ownSummaries[0], employeeDetailReports(own, '2026-09', employee), {});
      assert.ok(!ownCsv.includes('Private coworker'));
    }
    const coworkerToken = jwt.sign({ id: newJoiner, role: 'employee' }, secret);
    const coworker = await request('/my?period=2026-09', coworkerToken);
    assert.equal(coworker.employees[0].id, newJoiner);
    assert.ok(coworker.payslips.every((row) => row.employee_id === newJoiner));
    const emptyOwn = await request('/my?period=2025-01', employeeToken);
    assert.equal(emptyOwn.employees.length, 1); assert.equal(emptyOwn.payslips.length, 0);
    await request('?period=2026-09', coworkerToken, 403);
    console.log('Passed: employee self-reports, every-source ownership, spoofed employee IDs ignored, role restrictions, empty periods and private CSV exports.');
    console.log(`Passed: report access controls, validation, period boundaries, ${reports.filter((r) => !r.unavailable).length} live reports, filters, payroll and attendance totals, leave balances, loan snapshots, headcount, variance, empty states and CSV safety.`);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
    if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}
main().catch((err) => { console.error(err.stack); process.exitCode = 1; });
