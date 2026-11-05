const router = require('express').Router();
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { attendanceWithLeavePolicy } = require('../utils/leavePolicy');
const { LOCK } = require('../utils/loanRecovery');

router.use(authenticate);

const STATUSES = ['present', 'absent', 'leave', 'paid_leave'];
const DAY_TYPES = ['full', 'half'];
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v));
const isId = (v) => /^\d+$/.test(String(v ?? ''));

// GET /api/attendance/my  (employee: only their own records)
router.get('/my', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `${attendanceWithLeavePolicy}
     SELECT id, work_date::text AS work_date, status, day_type, note, check_in, check_out
     FROM policy_attendance WHERE employee_id = $1 ORDER BY work_date DESC`, [req.user.id]);
  res.json(rows);
}));

// ---------------------------------------------------------------------------
// Check in / check out (employees and managers).
// Times are stored as Indian local time, like the rest of attendance. The first check-in of the
// day sets the check-in time; later attempts are refused so the time cannot be moved.
// ---------------------------------------------------------------------------
const TODAY = "(NOW() AT TIME ZONE 'Asia/Kolkata')::date";
const LATE_AFTER = '09:10';
const selfOnly = authorize('employee', 'manager');

const stamp = (message, status = 409) => Object.assign(new Error(message), { status });
const clock = (value) => new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

async function todayRecord(db, employeeId) {
  const { rows } = await db.query(
    `SELECT id, status, day_type,
            (check_in AT TIME ZONE 'Asia/Kolkata') AS check_in,
            (check_out AT TIME ZONE 'Asia/Kolkata') AS check_out,
            (check_in::time > TIME '${LATE_AFTER}:00') AS is_late
     FROM attendance WHERE employee_id = $1 AND work_date = ${TODAY}`, [employeeId]);
  return rows[0] || null;
}

const wrap = (handler) => asyncHandler(async (req, res) => {
  try { await handler(req, res); } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  }
});

// GET /api/attendance/today
router.get('/today', selfOnly, wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT ${TODAY}::text AS date`);
  res.json({ date: rows[0].date, now: new Date().toISOString(), late_after: LATE_AFTER, record: await todayRecord(pool, req.user.id) });
}));

// POST /api/attendance/check-in
router.post('/check-in', selfOnly, wrap(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(LOCK);
    const person = (await client.query(
      `SELECT joining_date > ${TODAY} AS not_started, resignation_date < ${TODAY} AS has_left FROM employees WHERE id = $1`, [req.user.id])).rows[0];
    if (person.not_started || person.has_left) throw stamp('Your employment period does not include today.', 400);

    const existing = await todayRecord(client, req.user.id);
    if (existing) {
      if (['leave', 'paid_leave'].includes(existing.status)) throw stamp('Today is recorded as leave.');
      if (existing.check_in) throw stamp(`You already checked in at ${clock(existing.check_in)}.`);
      if (existing.status === 'absent') throw stamp('Today is marked absent. Ask your manager, or send a correction request.');
      // Marked present without a time (for example by a manager): add the time.
      await client.query(`UPDATE attendance SET check_in = NOW() AT TIME ZONE 'Asia/Kolkata' WHERE id = $1`, [existing.id]);
    } else {
      await client.query(
        `INSERT INTO attendance (employee_id, work_date, status, day_type, check_in, marked_by, marked_at)
         VALUES ($1, ${TODAY}, 'present', 'full', NOW() AT TIME ZONE 'Asia/Kolkata', $1, NOW())`, [req.user.id]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  res.status(201).json({ record: await todayRecord(pool, req.user.id) });
}));

// POST /api/attendance/check-out
router.post('/check-out', selfOnly, wrap(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(LOCK);
    const existing = await todayRecord(client, req.user.id);
    if (!existing || !existing.check_in) throw stamp('Check in first, then check out at the end of your day.');
    if (existing.check_out) throw stamp(`You already checked out at ${clock(existing.check_out)}.`);
    await client.query(`UPDATE attendance SET check_out = NOW() AT TIME ZONE 'Asia/Kolkata' WHERE id = $1`, [existing.id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  res.json({ record: await todayRecord(pool, req.user.id) });
}));

// GET /api/attendance/day?date=YYYY-MM-DD   (admin)
// Every active employee, with their status for that date (null = not marked)
router.get('/day', authorize('admin', 'manager'), asyncHandler(async (req, res) => {
  const { date } = req.query;
  if (!isDate(date)) return res.status(400).json({ message: 'date (YYYY-MM-DD) is required' });
  const teamOnly = req.user.role === 'manager';
  const { rows } = await pool.query(
    `${attendanceWithLeavePolicy}
     SELECT e.id AS employee_id, e.name, a.status, a.recorded_status, a.day_type, a.note
     FROM employees e
     LEFT JOIN policy_attendance a ON a.employee_id = e.id AND a.work_date = $1
     WHERE e.role IN ('employee', 'manager') AND e.is_active
       ${teamOnly ? 'AND e.manager_id = $2' : ''}
     ORDER BY e.name`, teamOnly ? [date, req.user.id] : [date]);
  res.json(rows);
}));

// PUT /api/attendance/bulk   (admin)
// { work_date, records: [{ employee_id, status, day_type, note }] }
// status '' / null clears the mark for that employee on that date.
router.put('/bulk', authorize('admin', 'manager'), asyncHandler(async (req, res) => {
  const { work_date, records } = req.body || {};
  if (!isDate(work_date) || !Array.isArray(records))
    return res.status(400).json({ message: 'work_date and records are required' });

  for (const r of records) {
    if (!isId(r.employee_id)) return res.status(400).json({ message: 'A valid employee_id is required' });
    if (r.status && !STATUSES.includes(r.status))
      return res.status(400).json({ message: `status must be one of: ${STATUSES.join(', ')}` });
    if (r.status && !DAY_TYPES.includes(r.day_type || 'full'))
      return res.status(400).json({ message: 'day_type must be full or half' });
  }

  if (req.user.role === 'manager') {
    const team = await pool.query('SELECT id FROM employees WHERE manager_id = $1 AND is_active', [req.user.id]);
    const teamIds = new Set(team.rows.map((row) => String(row.id)));
    if (records.some((r) => !teamIds.has(String(r.employee_id)))) {
      return res.status(403).json({ message: 'You can only mark attendance for your own team.' });
    }
    // Segregation of duties: once payroll for a month is finalized, only an administrator can reopen it.
    const locked = await pool.query(
      `SELECT 1 FROM payslips WHERE employee_id = ANY($1::int[]) AND status = 'finalized'
         AND month = EXTRACT(MONTH FROM $2::date) AND year = EXTRACT(YEAR FROM $2::date) LIMIT 1`,
      [records.map((r) => Number(r.employee_id)), work_date]);
    if (locked.rowCount) {
      return res.status(409).json({ message: 'Payroll for this month is finalized. Ask an administrator to reopen it before changing attendance.' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(LOCK);
    for (const r of records) {
      if (!r.status) {
        await client.query('DELETE FROM attendance WHERE employee_id = $1 AND work_date = $2', [r.employee_id, work_date]);
      } else {
        await client.query(
          `INSERT INTO attendance (employee_id, work_date, status, day_type, note, marked_by, marked_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())
           ON CONFLICT (employee_id, work_date)
           DO UPDATE SET status = EXCLUDED.status, day_type = EXCLUDED.day_type, note = EXCLUDED.note,
             marked_by = EXCLUDED.marked_by, marked_at = EXCLUDED.marked_at`,
          [r.employee_id, work_date, r.status, r.day_type || 'full', (r.note || '').trim() || null, req.user.id]);
      }
    }
    await client.query('COMMIT');
    res.json({ saved: records.length });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));


// GET /api/attendance?month=1-12&year=YYYY[&employee_id=][&date=]   (admin)
router.get('/', authorize('admin', 'manager'), asyncHandler(async (req, res) => {
  const { month, year, employee_id, date } = req.query;
  if (date && !isDate(date)) return res.status(400).json({ message: 'date must be YYYY-MM-DD' });
  if ((month || year) && !(Number.isInteger(Number(month)) && Number(month) >= 1 && Number(month) <= 12 && Number.isInteger(Number(year)) && Number(year) >= 2000 && Number(year) <= 2100))
    return res.status(400).json({ message: 'month (1-12) and year are required together' });
  if (employee_id && !isId(employee_id)) return res.status(400).json({ message: 'employee_id must be a number' });
  const where = [], vals = [];
  if (date) { vals.push(date); where.push(`a.work_date = $${vals.length}`); }
  if (month && year) {
    vals.push(Number(year), Number(month));
    where.push(`a.work_date >= make_date($${vals.length - 1}, $${vals.length}, 1)
                AND a.work_date < make_date($${vals.length - 1}, $${vals.length}, 1) + interval '1 month'`);
  }
  if (employee_id) { vals.push(employee_id); where.push(`a.employee_id = $${vals.length}`); }
  if (req.user.role === 'manager') { vals.push(req.user.id); where.push(`e.manager_id = $${vals.length}`); }
  const { rows } = await pool.query(
    `${attendanceWithLeavePolicy}
     SELECT a.id, a.employee_id, e.name, a.work_date::text AS work_date,
            a.status, a.day_type, a.note, a.check_in, a.check_out,
            (SELECT m.name FROM attendance x JOIN employees m ON m.id = x.marked_by WHERE x.id = a.id) AS marked_by_name
     FROM policy_attendance a JOIN employees e ON e.id = a.employee_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.work_date DESC, e.name`, vals);
  res.json(rows);
}));

// DELETE /api/attendance/:id  (admin)
router.delete('/:id', authorize('admin', 'manager'), asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ message: 'Invalid attendance id' });
  if (req.user.role === 'manager') {
    const own = await pool.query(
      'SELECT 1 FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.id = $1 AND e.manager_id = $2',
      [req.params.id, req.user.id]);
    if (!own.rowCount) return res.status(404).json({ message: 'Attendance record not found' });
    const locked = await pool.query(
      `SELECT 1 FROM attendance a JOIN payslips p ON p.employee_id = a.employee_id AND p.status = 'finalized'
         AND p.month = EXTRACT(MONTH FROM a.work_date) AND p.year = EXTRACT(YEAR FROM a.work_date)
       WHERE a.id = $1`, [req.params.id]);
    if (locked.rowCount) {
      return res.status(409).json({ message: 'Payroll for this month is finalized. Ask an administrator to reopen it before changing attendance.' });
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await client.query(LOCK);
    await client.query('DELETE FROM attendance WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  res.json({ message: 'Deleted' });
}));

module.exports = router;
