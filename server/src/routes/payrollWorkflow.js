const router = require('express').Router();
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authorize } = require('../middleware/auth');
const { LOCK, planRecoveries, saveRecoveries } = require('../utils/loanRecovery');
const payroll = require('../utils/payroll');
const checklist = require('../utils/payrollChecklist');
const { fail, date, today } = require('../utils/payrollValidation');

function action(handler) {
  return asyncHandler(async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (error.status) return res.status(error.status).json({ message: error.message });
      throw error;
    }
  });
}

// Read-only calls (checklist, preview) pass lock=false so they never queue behind a long-running one.
async function transaction(handler, lock = true) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (lock) await client.query(LOCK);
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

// Managers prepare payroll for their own direct reports; administrators for everyone.
const staff = authorize('admin', 'manager');
const withScope = (req, input) => {
  input.teamManagerId = req.user.role === 'manager' ? req.user.id : null;
  return input;
};

router.get('/checklist', staff, action(async (req, res) => {
  const input = withScope(req, payroll.inputs(req.query));
  res.json(await transaction(async (client) => {
    await planRecoveries(client, input.employeeId, input.month, input.year);
    return checklist(client, input);
  }, false));
}));

router.post('/preview', staff, action(async (req, res) => {
  const input = withScope(req, payroll.inputs(req.body || {}));
  if (!input.employeeId) fail('Select an employee to preview payroll.');
  res.json(await transaction(async (client) => {
    const employees = await payroll.eligibleEmployees(client, input);
    if (!employees.length) fail('Employee is not eligible in this month.');
    await planRecoveries(client, input.employeeId, input.month, input.year);
    return payroll.calculate(client, employees[0], input);
  }, false));
}));

router.post('/generate', staff, action(async (req, res) => {
  const input = withScope(req, payroll.inputs(req.body || {}));
  const result = await transaction(async (client) => {
    await planRecoveries(client, input.employeeId, input.month, input.year);
    const saved = await payroll.generate(client, input, req.user.id);
    await saveRecoveries(client, saved.payslipIds);
    delete saved.payslipIds;
    return saved;
  });
  res.status(201).json(result);
}));

async function lockedSlip(client, id) {
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) fail('A valid payslip is required.');
  const slip = (await client.query('SELECT * FROM payslips WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!slip) fail('Payslip not found.', 404);
  return slip;
}

// A manager may act only on payslips of their own direct reports (404 otherwise).
async function teamSlip(client, req, id) {
  const slip = await lockedSlip(client, id);
  if (req.user.role === 'manager') {
    const own = await client.query('SELECT 1 FROM employees WHERE id = $1 AND manager_id = $2', [slip.employee_id, req.user.id]);
    if (!own.rowCount) fail('Payslip not found.', 404);
  }
  return slip;
}

async function submitSlip(client, before, actorId) {
  if (before.status !== 'draft') fail('Only draft payslips can be submitted for approval.', 409);
  if (Number(before.net_pay) < 0) fail('A negative take-home amount cannot be submitted.');
  const pending = await client.query(`SELECT 1 FROM leaves WHERE employee_id = $1 AND status = 'pending'
    AND start_date < make_date($3, $2, 1) + interval '1 month' AND end_date >= make_date($3, $2, 1) LIMIT 1`,
  [before.employee_id, before.month, before.year]);
  if (pending.rowCount) fail('Resolve pending leave requests for this month before submitting payroll.', 409);
  const after = (await client.query(`UPDATE payslips SET status = 'submitted', submitted_by = $2, submitted_at = NOW(),
    updated_at = NOW() WHERE id = $1 RETURNING *`, [before.id, actorId])).rows[0];
  await payroll.event(client, before, after, actorId, 'submitted');
  return after;
}

async function publishSlip(client, before, actorId) {
  if (before.status !== 'finalized') fail('Only payroll approved and finalized by an administrator can be published.', 409);
  if (before.published_at) fail('This payslip is already published.', 409);
  const after = (await client.query(`UPDATE payslips SET published_at = NOW(), published_by = $2, updated_at = NOW()
    WHERE id = $1 RETURNING *`, [before.id, actorId])).rows[0];
  await payroll.event(client, before, after, actorId, 'published');
  return after;
}

async function bulk(req, extraWhere, handler) {
  const input = payroll.inputs(req.body || {});
  return transaction(async (client) => {
    const { rows } = await client.query(`SELECT p.*, e.name FROM payslips p JOIN employees e ON e.id = p.employee_id
      WHERE p.month = $1 AND p.year = $2 AND ($3::int IS NULL OR e.manager_id = $3) ${extraWhere}
      ORDER BY e.name FOR UPDATE OF p`, [input.month, input.year, req.user.role === 'manager' ? req.user.id : null]);
    const done = [], skipped = [];
    for (const slip of rows) {
      try { await handler(client, slip, req.user.id); done.push(slip.id); }
      catch (error) {
        if (!error.status) throw error;
        skipped.push({ employee_id: slip.employee_id, name: slip.name, message: error.message });
      }
    }
    return { count: done.length, skipped };
  });
}

// Manager: send drafts to the administrator for approval.
router.post('/submit', staff, action(async (req, res) => {
  res.json(await bulk(req, "AND p.status = 'draft'", submitSlip));
}));

// Manager or administrator: release approved payslips to employees.
router.post('/publish', staff, action(async (req, res) => {
  res.json(await bulk(req, "AND p.status = 'finalized' AND p.published_at IS NULL", publishSlip));
}));

router.patch('/:id/submit', staff, action(async (req, res) => {
  res.json(await transaction(async (client) => submitSlip(client, await teamSlip(client, req, req.params.id), req.user.id)));
}));

router.patch('/:id/publish', staff, action(async (req, res) => {
  res.json(await transaction(async (client) => publishSlip(client, await teamSlip(client, req, req.params.id), req.user.id)));
}));

router.get('/:id/events', authorize('admin'), action(async (req, res) => {
  const { rows } = await pool.query(`SELECT v.id, v.action, v.reason, v.created_at,
    COALESCE(e.name, 'System') AS actor FROM payroll_events v LEFT JOIN employees e ON e.id = v.actor_id
    WHERE v.payslip_id = $1 ORDER BY v.created_at DESC, v.id DESC`, [req.params.id]);
  res.json(rows);
}));

router.patch('/:id/status', authorize('admin'), action(async (req, res) => {
  const status = req.body?.status;
  if (!['draft', 'reviewed', 'finalized'].includes(status)) fail('Invalid payroll status.');
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const result = await transaction(async (client) => {
    const before = await lockedSlip(client, req.params.id);
    if (before.status === status) fail('Payslip already has this status.', 409);
    if (before.payment_status === 'paid') fail('Reverse the recorded payment before reopening this payslip.', 409);
    if (status === 'reviewed' && before.status !== 'draft') fail('Only draft payslips can be reviewed.', 409);
    if (status === 'finalized') {
      if (!['reviewed', 'submitted'].includes(before.status)) fail('Review or submit this payslip before approving it.', 409);
      if (Number(before.net_pay) < 0) fail('A negative take-home amount cannot be finalized.');
      if (before.calculation_snapshot) {
        const input = payroll.inputs({ employee_id: before.employee_id, month: before.month, year: before.year,
          allowances: before.allowances, deductions: before.additional_deductions,
          ...before.calculation_snapshot.overrides });
        const eligible = await payroll.eligibleEmployees(client, input);
        if (!eligible.length) fail('Employment dates changed. Reopen and recalculate payroll before finalizing.', 409);
        await planRecoveries(client, input.employeeId, input.month, input.year);
        const latest = await payroll.calculate(client, eligible[0], input);
        const keys = ['basic','hra','special_allowance','lta','other_allowances','epf','professional_tax','advance','deductions','net_pay','employed_days','net_paid_days','late_login_deduction','late_login_count'];
        if (latest.missingSalary || keys.some((key) => Number(latest[key]) !== Number(before[key]))) {
          fail('Salary, attendance or employment details changed. Reopen and update this payslip before finalizing.', 409);
        }
      }
      const pending = await client.query(`SELECT 1 FROM leaves WHERE employee_id = $1 AND status = 'pending'
        AND start_date < make_date($3, $2, 1) + interval '1 month' AND end_date >= make_date($3, $2, 1) LIMIT 1`,
      [before.employee_id, before.month, before.year]);
      if (pending.rowCount) fail('Resolve pending leave requests for this month before finalizing payroll.', 409);
      const gross = ['basic','hra','special_allowance','lta','other_allowances','allowances'].reduce((n,k) => n + Number(before[k]), 0);
      if (gross > 0 && (gross - Number(before.net_pay)) > gross / 2 && req.body?.acknowledge_warnings !== true) {
        fail('Deductions exceed 50% of earnings. Confirm that you reviewed this warning before finalizing.');
      }
    }
    if (status === 'draft' && (!reason || reason.length > 1000)) fail('A correction reason (up to 1000 characters) is required to reopen payroll.');
    const after = (await client.query(`UPDATE payslips SET status = $2::varchar, updated_at = NOW(),
      reviewed_by = CASE WHEN $2 = 'reviewed' THEN $3 WHEN $2 = 'draft' THEN NULL ELSE reviewed_by END,
      reviewed_at = CASE WHEN $2 = 'reviewed' THEN NOW() WHEN $2 = 'draft' THEN NULL ELSE reviewed_at END,
      finalized_by = CASE WHEN $2 = 'finalized' THEN $3 ELSE NULL END,
      finalized_at = CASE WHEN $2 = 'finalized' THEN NOW() ELSE NULL END,
      submitted_by = CASE WHEN $2 = 'draft' THEN NULL ELSE submitted_by END,
      submitted_at = CASE WHEN $2 = 'draft' THEN NULL ELSE submitted_at END,
      published_by = CASE WHEN $2 = 'draft' THEN NULL ELSE published_by END,
      published_at = CASE WHEN $2 = 'draft' THEN NULL ELSE published_at END WHERE id = $1 RETURNING *`,
    [before.id, status, req.user.id])).rows[0];
    await payroll.event(client, before, after, req.user.id, status === 'draft' ? 'reopened' : status, reason);
    return after;
  });
  res.json(result);
}));

router.patch('/:id/payment', authorize('admin'), action(async (req, res) => {
  const status = req.body?.payment_status;
  if (!['paid', 'unpaid'].includes(status)) fail('Invalid payment status.');
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const reference = typeof req.body?.payment_reference === 'string' ? req.body.payment_reference.trim() : '';
  if (status === 'paid' && (!date(req.body?.paid_on) || req.body.paid_on > today() || !reference || reference.length > 150)) {
    fail('A payment date no later than today and a reference (up to 150 characters) are required.');
  }
  if (status === 'unpaid' && (!reason || reason.length > 1000)) fail('A payment reversal reason is required (up to 1000 characters).');
  res.json(await transaction(async (client) => {
    const before = await lockedSlip(client, req.params.id);
    if (before.status !== 'finalized') fail('Only finalized payroll can have a payment recorded.', 409);
    if (before.payment_status === status) fail('Payment already has this status.', 409);
    const after = (await client.query(`UPDATE payslips SET payment_status = $2::varchar, paid_on = $3,
      payment_reference = $4, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [before.id, status, status === 'paid' ? req.body.paid_on : null, status === 'paid' ? reference : null])).rows[0];
    await payroll.event(client, before, after, req.user.id, status === 'paid' ? 'payment_recorded' : 'payment_reversed', reason || reference);
    return after;
  }));
}));

router.delete('/:id', authorize('admin'), action(async (req, res) => {
  await transaction(async (client) => {
    const before = await lockedSlip(client, req.params.id);
    if (before.status === 'finalized' || before.payment_status === 'paid') fail('Finalized or paid payslips cannot be deleted. Reopen with a correction reason first.', 409);
    await payroll.event(client, before, null, req.user.id, 'deleted');
    await client.query('DELETE FROM payslips WHERE id = $1', [before.id]);
  });
  res.json({ message: 'Deleted' });
}));

module.exports = router;
