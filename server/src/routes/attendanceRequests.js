const router = require('express').Router();
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { LOCK } = require('../utils/loanRecovery');
const { date, today } = require('../utils/payrollValidation');
const { ATTENDANCE_REQUEST_WINDOW_DAYS, ESCALATE_AFTER_DAYS } = require('../utils/workflowPolicy');

router.use(authenticate);

// Attendance regularization: an employee asks for a missed or wrong day to be recorded as present;
// the line manager (or an administrator when there is no manager) approves or rejects it.
const REQUESTS = `
  SELECT r.id, r.employee_id, e.name, e.emp_code, r.work_date::text AS work_date, r.day_type, r.reason,
    to_char(r.check_in_time, 'HH24:MI') AS check_in_time, to_char(r.check_out_time, 'HH24:MI') AS check_out_time,
    r.status, r.decision_note, r.decided_at, r.created_at,
    (SELECT name FROM employees WHERE id = r.decided_by) AS decided_by_name,
    m.name AS manager_name,
    (CURRENT_DATE - r.created_at::date)::int AS waiting_days,
    (r.status = 'pending' AND e.manager_id IS NOT NULL AND (CURRENT_DATE - r.created_at::date) >= ${ESCALATE_AFTER_DAYS}) AS escalated
  FROM attendance_requests r
  JOIN employees e ON e.id = r.employee_id
  LEFT JOIN employees m ON m.id = e.manager_id`;

const ORDER = `ORDER BY (r.status = 'pending') DESC, r.created_at DESC, r.id DESC`;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

const handle = (fn) => asyncHandler(async (req, res) => {
  try { await fn(req, res); } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  }
});

// Attendance for a month whose payroll is finalized must not change without reopening payroll.
async function payrollLocked(client, employeeId, workDate) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM payslips WHERE employee_id = $1 AND status = 'finalized'
       AND month = EXTRACT(MONTH FROM $2::date) AND year = EXTRACT(YEAR FROM $2::date)`, [employeeId, workDate]);
  return rowCount > 0;
}

router.get('/my', authorize('employee', 'manager'), handle(async (req, res) => {
  const { rows } = await pool.query(`${REQUESTS} WHERE r.employee_id = $1 ${ORDER}`, [req.user.id]);
  res.json(rows);
}));

router.get('/team', authorize('manager'), handle(async (req, res) => {
  const { rows } = await pool.query(`${REQUESTS} WHERE e.manager_id = $1 AND e.is_active ${ORDER}`, [req.user.id]);
  res.json(rows);
}));

router.get('/', authorize('admin'), handle(async (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await pool.query(`${REQUESTS} WHERE ($1::text IS NULL OR r.status = $1) ${ORDER} LIMIT 500`, [status]);
  res.json(rows);
}));

router.post('/', authorize('employee', 'manager'), handle(async (req, res) => {
  const { work_date, day_type = 'full', reason } = req.body || {};
  const timeOf = (value) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail(400, 'Times must look like 09:30.');
    return value;
  };
  const checkInTime = timeOf(req.body?.check_in_time);
  const checkOutTime = timeOf(req.body?.check_out_time);
  if (checkInTime && checkOutTime && checkOutTime <= checkInTime) fail(400, 'Check-out must be after check-in.');
  if (!date(work_date)) fail(400, 'Choose a valid date.');
  if (!['full', 'half'].includes(day_type)) fail(400, 'Day type must be full or half.');
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text || text.length > 500) fail(400, 'Give a reason (up to 500 characters).');
  const todayIst = today();
  if (work_date > todayIst) fail(400, 'You cannot request attendance for a future date.');
  const oldest = new Date(`${todayIst}T00:00:00Z`);
  oldest.setUTCDate(oldest.getUTCDate() - ATTENDANCE_REQUEST_WINDOW_DAYS);
  if (work_date < oldest.toISOString().slice(0, 10)) fail(400, `Requests can go back ${ATTENDANCE_REQUEST_WINDOW_DAYS} days.`);

  const { rows: people } = await pool.query(
    'SELECT joining_date::text, resignation_date::text FROM employees WHERE id = $1', [req.user.id]);
  const person = people[0];
  if ((person.joining_date && work_date < person.joining_date) || (person.resignation_date && work_date > person.resignation_date)) {
    fail(400, 'That date is outside your employment period.');
  }
  const existing = await pool.query(
    `SELECT status, day_type, check_in::time::text AS check_in_clock FROM attendance WHERE employee_id = $1 AND work_date = $2`, [req.user.id, work_date]);
  if (existing.rows[0]) {
    const { status, day_type: marked, check_in_clock: knownIn } = existing.rows[0];
    if (['leave', 'paid_leave'].includes(status)) fail(409, 'That day is recorded as leave.');
    // A present day can still be corrected when the request supplies a missing or wrong time.
    if (status === 'present' && (marked === 'full' || day_type === 'half') && !checkInTime && !checkOutTime) {
      fail(409, 'That day is already marked present. To fix a time, enter the check-in or check-out time.');
    }
    if (checkOutTime && !checkInTime && knownIn && checkOutTime <= knownIn.slice(0, 5)) fail(400, 'Check-out must be after your recorded check-in.');
  }
  if (await payrollLocked(pool, req.user.id, work_date)) {
    fail(409, 'Payroll for that month is already finalized. Ask an administrator.');
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO attendance_requests (employee_id, work_date, day_type, reason, check_in_time, check_out_time)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.id, work_date, day_type, text, checkInTime, checkOutTime]);
    res.status(201).json({ id: rows[0].id });
  } catch (error) {
    if (error.code === '23505') fail(409, 'You already have a pending request for that date.');
    throw error;
  }
}));

router.delete('/:id', authorize('employee', 'manager'), handle(async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || Number(req.params.id) > 2147483647) fail(400, 'Invalid request.');
  const { rowCount } = await pool.query(
    `UPDATE attendance_requests SET status = 'cancelled', decided_at = NOW()
     WHERE id = $1 AND employee_id = $2 AND status = 'pending'`, [req.params.id, req.user.id]);
  if (!rowCount) fail(404, 'No pending request found.');
  res.json({ message: 'Request withdrawn.' });
}));

router.patch('/:id/decision', authorize('admin', 'manager'), handle(async (req, res) => {
  const { decision, note } = req.body || {};
  if (!/^\d+$/.test(req.params.id) || Number(req.params.id) > 2147483647) fail(400, 'Invalid request.');
  if (!['approved', 'rejected'].includes(decision)) fail(400, 'Decision must be approved or rejected.');
  const text = typeof note === 'string' ? note.trim() : '';
  if (decision === 'rejected' && (!text || text.length > 500)) fail(400, 'A reason for rejecting is required (up to 500 characters).');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(LOCK);
    const { rows } = await client.query(
      `SELECT r.*, r.work_date::text AS day, to_char(r.check_in_time, 'HH24:MI') AS in_clock, to_char(r.check_out_time, 'HH24:MI') AS out_clock, e.manager_id FROM attendance_requests r
       JOIN employees e ON e.id = r.employee_id WHERE r.id = $1 FOR UPDATE OF r`, [req.params.id]);
    const request = rows[0];
    // Managers only decide their own team's requests; anything else looks like it does not exist.
    if (!request || (req.user.role === 'manager' && request.manager_id !== req.user.id)) fail(404, 'Request not found.');
    if (request.status !== 'pending') fail(409, `This request is already ${request.status}.`);

    if (decision === 'approved') {
      if (await payrollLocked(client, request.employee_id, request.day)) {
        fail(409, 'Payroll for that month is finalized. Reopen it before changing attendance.');
      }
      await client.query(
        `INSERT INTO attendance (employee_id, work_date, status, day_type, note, marked_by, marked_at, check_in, check_out)
         VALUES ($1, $2, 'present', $3, $4, $5, NOW(),
           CASE WHEN $6::text IS NULL THEN NULL ELSE ($2::date + $6::time) END,
           CASE WHEN $7::text IS NULL THEN NULL ELSE ($2::date + $7::time) END)
         ON CONFLICT (employee_id, work_date) DO UPDATE SET status = 'present', day_type = EXCLUDED.day_type,
           note = EXCLUDED.note, marked_by = EXCLUDED.marked_by, marked_at = NOW(),
           check_in = COALESCE(EXCLUDED.check_in, attendance.check_in),
           check_out = COALESCE(EXCLUDED.check_out, attendance.check_out)`,
        [request.employee_id, request.day, request.day_type, `Regularized: ${request.reason}`.slice(0, 500), req.user.id, request.in_clock, request.out_clock]);
    }
    await client.query(
      `UPDATE attendance_requests SET status = $2, decided_by = $3, decided_at = NOW(), decision_note = $4 WHERE id = $1`,
      [request.id, decision, req.user.id, text || null]);
    await client.query('COMMIT');
    res.json({ id: request.id, status: decision });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}));

module.exports = router;
