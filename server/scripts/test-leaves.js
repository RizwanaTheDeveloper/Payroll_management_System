// Real API checks in a disposable schema; existing employee data is untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../src/config/db');
const { calcPayDays } = require('../src/utils/payDays');

async function main() {
  const schema = `leave_test_${process.pid}_${Date.now()}`;
  assert.match(schema, /^leave_test_\d+_\d+$/);
  const admin = new Client({ ...pool.options, connectionTimeoutMillis: 5000 });
  let server, schemaCreated = false;
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    pool.options.options = `-c search_path=${schema}`;
    await pool.query(fs.readFileSync(path.join(__dirname, '../src/schema.sql'), 'utf8'));
    const employee = (await pool.query(`INSERT INTO employees
      (emp_code,name,email,password_hash,role,basic,joining_date)
      VALUES ('TEST-E','Employee','employee@test.invalid','unused','employee',31000,'2020-01-01') RETURNING id`)).rows[0].id;
    const administrator = (await pool.query(`INSERT INTO employees
      (emp_code,name,email,password_hash,role)
      VALUES ('TEST-A','Admin','admin@test.invalid','unused','admin') RETURNING id`)).rows[0].id;
    const secret = process.env.JWT_SECRET || 'isolated-leave-test-secret';
    process.env.JWT_SECRET = secret;
    const token = jwt.sign({ id: administrator, role: 'admin' }, secret);
    const employeeToken = jwt.sign({ id: employee, role: 'employee' }, secret);
    const app = express();
    app.use(express.json());
    app.use('/attendance', require('../src/routes/attendance'));
    app.use('/leaves', require('../src/routes/leaves'));
    app.use('/payslips', require('../src/routes/payslips'));
    app.use((err, req, res, next) => res.status(500).json({ message: err.message }));
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    async function request(url, method = 'GET', body, auth = token, expected = 200) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(data)}`);
      return data;
    }
    async function mark(day, status) {
      await request('/attendance/bulk', 'PUT', { work_date: `2026-01-${day}`,
        records: [{ employee_id: employee, status, day_type: 'full' }] });
    }
    const rejectedLeave = await request('/leaves', 'POST', { leave_type: 'sick',
      start_date: '2026-03-01', end_date: '2026-03-02', reason: 'Medical appointment' }, employeeToken, 201);
    for (const rejection_reason of [undefined, '', '   ', 123, {}]) {
      await request(`/leaves/${rejectedLeave.id}/status`, 'PATCH',
        { status: 'rejected', rejection_reason }, token, 400);
    }
    assert.equal((await request('/leaves/my', 'GET', null, employeeToken))[0].status, 'pending');
    await request(`/leaves/${rejectedLeave.id}/status`, 'PATCH',
      { status: 'rejected', rejection_reason: 'Unavailable cover' }, employeeToken, 403);
    const rejection = await request(`/leaves/${rejectedLeave.id}/status`, 'PATCH',
      { status: 'rejected', rejection_reason: '  Please choose another date.  ' });
    assert.equal(rejection.rejection_reason, 'Please choose another date.');
    for (const [url, auth] of [['/leaves', token], ['/leaves/my', employeeToken]]) {
      const saved = (await request(url, 'GET', null, auth)).find((row) => row.id === rejectedLeave.id);
      assert.equal(saved.status, 'rejected');
      assert.equal(saved.reason, 'Medical appointment');
      assert.equal(saved.rejection_reason, 'Please choose another date.');
    }
    assert.equal((await request('/attendance?month=3&year=2026')).length, 0);
    await request(`/leaves/${rejectedLeave.id}/status`, 'PATCH',
      { status: 'rejected', rejection_reason: 'Changed reason' }, token, 409);

    // Multipart attachments are optional, persisted, and private to owner/admin.
    const otherEmployee = (await pool.query(`INSERT INTO employees
      (emp_code,name,email,password_hash,role)
      VALUES ('TEST-O','Other employee','other@test.invalid','unused','employee') RETURNING id`)).rows[0].id;
    const otherToken = jwt.sign({ id: otherEmployee, role: 'employee' }, secret);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5GQAAAAASUVORK5CYII=', 'base64');
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
    async function upload(files, expected = 201, fields = {}, auth = employeeToken) {
      const form = new FormData();
      const values = { leave_type: 'sick', start_date: '2026-05-10', end_date: '2026-05-11',
        reason: 'Medical certificate attached', ...fields };
      Object.entries(values).forEach(([key, value]) => form.append(key, value));
      for (const file of files) {
        form.append('medical_documents', new Blob([file.bytes], { type: file.type }), file.name);
      }
      const response = await fetch(`http://127.0.0.1:${server.address().port}/leaves`, {
        method: 'POST', headers: { Authorization: `Bearer ${auth}` }, body: form,
      });
      const result = await response.json();
      assert.equal(response.status, expected, JSON.stringify(result));
      return result;
    }
    const images = [{ name: 'certificate.png', type: 'image/png', bytes: png }];
    await upload([{ name: 'notes.txt', type: 'text/plain', bytes: 'text' }], 400);
    await upload([{ name: 'fake.pdf', type: 'application/pdf', bytes: 'text' }], 400);
    await upload([{ name: 'empty.pdf', type: 'application/pdf', bytes: '' }], 400);
    await upload([{ name: 'wrong.png', type: 'image/png', bytes: pdf }], 400);
    await upload([{ name: 'large.png', type: 'image/png', bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }], 400);
    await upload([...images, ...images, ...images, ...images], 400);
    await upload(images, 400, { reason: '' });
    await upload(images, 403, {}, token);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM leave_documents')).rows[0].count, 0);
    const withDocuments = await upload([...images,
      { name: 'medical report.pdf', type: 'application/pdf', bytes: pdf },
      { name: 'scan.png', type: 'image/png', bytes: png }]);
    assert.equal(withDocuments.medical_documents.length, 3);
    const document = withDocuments.medical_documents[0];
    const documentPath = `/leaves/${withDocuments.id}/documents/${document.id}`;
    for (const auth of [employeeToken, token]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${documentPath}`, {
        headers: { Authorization: `Bearer ${auth}` },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.match(response.headers.get('content-disposition'), /certificate\.png/);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    }
    await request(documentPath, 'GET', null, otherToken, 404);
    await request(documentPath, 'GET', null, '', 401);
    await request(`/leaves/${rejectedLeave.id}/documents/${document.id}`, 'GET', null, token, 404);
    await request(`/leaves/${withDocuments.id}/documents/2147483647`, 'GET', null, token, 404);
    for (const [url, auth] of [['/leaves', token], ['/leaves/my', employeeToken]]) {
      const saved = (await request(url, 'GET', null, auth)).find((row) => row.id === withDocuments.id);
      assert.deepEqual(saved.medical_documents, withDocuments.medical_documents);
      assert.ok(saved.medical_documents.every((file) => !('content' in file)));
    }
    assert.deepEqual(await request('/leaves/my', 'GET', null, otherToken), []);
    await upload(images, 409);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM leave_documents')).rows[0].count, 3);
    await request(`/leaves/${withDocuments.id}/status`, 'PATCH', { status: 'rejected', rejection_reason: 'Different date needed' });
    assert.equal((await request('/leaves/my', 'GET', null, employeeToken)).find((row) => row.id === withDocuments.id).medical_documents.length, 3);
    const noDocuments = await upload([], 201);
    assert.deepEqual(noDocuments.medical_documents, []);
    // A document save failure rolls back the leave too.
    await pool.query("ALTER TABLE leave_documents ADD CONSTRAINT test_save_failure CHECK (filename <> 'fail.png')");
    await upload([{ name: 'fail.png', type: 'image/png', bytes: png }], 500,
      { start_date: '2026-06-01', end_date: '2026-06-01' });
    assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM leaves WHERE start_date = '2026-06-01'")).rows[0].count, 0);
    await pool.query('ALTER TABLE leave_documents DROP CONSTRAINT test_save_failure');
    console.log('Passed: multipart medical documents, optional uploads, size/type/count checks, database byte preservation, admin/owner access, unauthorized access blocked, attachment metadata, overlap cleanup and atomic saves.');

    // Pending requests do not consume the allowance; approved days do.
    const leave = await request('/leaves', 'POST', { leave_type: 'paid',
      start_date: '2026-01-10', end_date: '2026-01-12', reason: 'Test' }, employeeToken, 201);
    assert.equal((await calcPayDays(employee, 1, 2026, pool)).netPaidDays, 31);
    const approval = await request(`/leaves/${leave.id}/status`, 'PATCH', { status: 'approved' });
    assert.equal(approval.rejection_reason, null);
    const rows = await request('/attendance?month=1&year=2026');
    assert.deepEqual(rows.map((row) => row.status), ['absent', 'paid_leave', 'paid_leave']);
    assert.equal((await request('/attendance/my', 'GET', null, employeeToken))[0].status, 'absent');
    const day = (await request('/attendance/day?date=2026-01-12'))[0];
    assert.equal(day.status, 'absent');
    assert.equal(day.recorded_status, 'paid_leave', 'Saving unchanged attendance preserves its original leave mark');
    assert.equal((await calcPayDays(employee, 1, 2026, pool)).unpaidLeaveDays, 1);
    await request('/payslips/generate', 'POST', { employee_id: employee, month: 1, year: 2026 }, token, 201);
    let payslip = (await request('/payslips?month=1&year=2026'))[0];
    assert.equal(Number(payslip.deductions), 1000);
    assert.equal(Number(payslip.unpaid_leave_deduction), 1000, 'The third monthly leave day is deducted as loss of pay');
    assert.equal(Number(payslip.net_pay), 28000);
    let preview = await request('/payslips/preview', 'POST',
      { employee_id: employee, month: 1, year: 2026 });
    assert.equal(preview.unpaid_leave_deduction, 1000, 'Payroll preview includes loss of pay for the third leave day');
    assert.equal(preview.calculation_snapshot.unpaid_dates.length, 1, 'Payroll preview shows the unpaid leave day');
    await mark('05', 'leave');
    assert.equal((await calcPayDays(employee, 1, 2026, pool)).unpaidLeaveDays, 2, 'Backdated leave recalculates chronological allowance');
    preview = await request('/payslips/preview', 'POST',
      { employee_id: employee, month: 1, year: 2026 });
    assert.equal(preview.unpaid_leave_deduction, 2000, 'Payroll preview recalculates loss of pay after backdated leave');
    assert.equal(preview.calculation_snapshot.unpaid_dates.length, 2, 'Payroll preview lists each unpaid leave day');
    await request('/payslips/generate', 'POST', { employee_id: employee, month: 1, year: 2026,
      mode: 'update', deductions: 50 }, token, 201);
    payslip = (await request('/payslips?month=1&year=2026'))[0];
    assert.equal(Number(payslip.unpaid_leave_deduction), 2000, 'The fourth leave day is also unpaid');
    assert.equal(Number(payslip.deductions), 2050);
    assert.equal(Number(payslip.net_pay), 26950);
    await mark('05', 'present');
    await mark('10', 'present');
    assert.equal((await calcPayDays(employee, 1, 2026, pool)).unpaidLeaveDays, 0, 'Corrected attendance restores paid leave');
    const spanning = await request('/leaves', 'POST', { leave_type: 'casual',
      start_date: '2026-01-30', end_date: '2026-02-03', reason: 'Cross month' }, employeeToken, 201);
    await request(`/leaves/${spanning.id}/status`, 'PATCH', { status: 'approved' });
    assert.equal((await calcPayDays(employee, 2, 2026, pool)).unpaidLeaveDays, 1, 'Allowance resets each month');
    assert.equal((await calcPayDays(employee, 1, 2026, pool)).unpaidLeaveDays, 2);
    await mark('29', 'absent');
    assert.equal((await calcPayDays(employee, 1, 2026, pool)).unpaidLeaveDays, 3, 'Explicit unpaid days do not consume paid allowance');
    console.log('Passed: required rejection reasons, authorization, saved reasons in admin and employee views, rejection without attendance changes, approval, two paid days, excess unpaid days, all attendance views, backdated edits, payroll deductions and updates, monthly reset and cross-month requests.');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
    if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}
main().catch((err) => { console.error(err.message); process.exitCode = 1; });
