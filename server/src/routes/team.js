const router = require('express').Router();
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');

// Everything here is scoped to the signed-in manager's direct reports and
// deliberately excludes salary, deduction and payslip data.
router.use(authenticate, authorize('manager'));

const TODAY = "(NOW() AT TIME ZONE 'Asia/Kolkata')::date";

// GET /api/team/summary  - today's snapshot of the team and items awaiting the manager
router.get('/summary', asyncHandler(async (req, res) => {
  const members = await pool.query(
    `SELECT e.id, e.emp_code, e.name, e.designation, e.department,
            a.status AS today_status, a.day_type, a.check_in,
            (SELECT COUNT(*) FROM leaves l WHERE l.employee_id = e.id AND l.status = 'pending')::int AS pending_leaves,
            EXISTS (SELECT 1 FROM leaves l WHERE l.employee_id = e.id AND l.status = 'approved'
                    AND ${TODAY} BETWEEN l.start_date AND l.end_date) AS on_leave_today
     FROM employees e
     LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date = ${TODAY}
     WHERE e.manager_id = $1 AND e.is_active
     ORDER BY e.name`, [req.user.id]);

  const credit = await pool.query(
    `SELECT a.record_type, COUNT(*)::int AS count
     FROM advances a JOIN employees e ON e.id = a.employee_id
     WHERE e.manager_id = $1 AND e.is_active AND a.status = 'pending' AND a.manager_decision IS NULL
     GROUP BY a.record_type`, [req.user.id]);

  const upcoming = await pool.query(
    `SELECT l.id, e.name, l.leave_type, l.start_date::text AS start_date, l.end_date::text AS end_date
     FROM leaves l JOIN employees e ON e.id = l.employee_id
     WHERE e.manager_id = $1 AND e.is_active AND l.status = 'approved'
       AND l.end_date >= ${TODAY} AND l.start_date <= ${TODAY} + 14
     ORDER BY l.start_date, e.name`, [req.user.id]);

  const attendanceRequests = await pool.query(
    `SELECT COUNT(*)::int AS n FROM attendance_requests r JOIN employees e ON e.id = r.employee_id
     WHERE e.manager_id = $1 AND e.is_active AND r.status = 'pending'`, [req.user.id]);

  const rows = members.rows;
  const countOf = (type) => credit.rows.find((r) => r.record_type === type)?.count || 0;
  res.json({
    team_size: rows.length,
    present_today: rows.filter((m) => m.today_status === 'present').length,
    absent_today: rows.filter((m) => m.today_status === 'absent').length,
    on_leave_today: rows.filter((m) => m.on_leave_today || ['leave', 'paid_leave'].includes(m.today_status)).length,
    not_marked_today: rows.filter((m) => !m.today_status && !m.on_leave_today).length,
    pending_leaves: rows.reduce((sum, m) => sum + m.pending_leaves, 0),
    pending_loans: countOf('loan'),
    pending_advances: countOf('salary_advance'),
    pending_attendance_requests: attendanceRequests.rows[0].n,
    members: rows,
    upcoming_leave: upcoming.rows,
  });
}));

// GET /api/team/report?month=1-12&year=YYYY  - monthly attendance and leave per team member
router.get('/report', asyncHandler(async (req, res) => {
  const month = Number(req.query.month);
  const year = Number(req.query.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ message: 'month (1-12) and year are required' });
  }
  const { rows } = await pool.query(
    `WITH period AS (SELECT make_date($2, $3, 1) AS start_date, (make_date($2, $3, 1) + interval '1 month')::date AS end_date)
     SELECT e.id, e.emp_code, e.name, e.designation,
       COALESCE(SUM(CASE WHEN a.status = 'present' THEN (CASE WHEN a.day_type = 'half' THEN 0.5 ELSE 1 END) END), 0)::float AS present_days,
       COALESCE(SUM(CASE WHEN a.status = 'absent' THEN (CASE WHEN a.day_type = 'half' THEN 0.5 ELSE 1 END) END), 0)::float AS absent_days,
       COUNT(*) FILTER (WHERE a.status = 'leave')::int AS leave_days,
       COUNT(*) FILTER (WHERE a.status = 'paid_leave')::int AS paid_leave_days,
       (SELECT COUNT(*) FROM leaves l, period p WHERE l.employee_id = e.id AND l.status = 'approved'
          AND l.start_date < p.end_date AND l.end_date >= p.start_date)::int AS approved_requests,
       (SELECT COUNT(*) FROM leaves l, period p WHERE l.employee_id = e.id AND l.status = 'pending'
          AND l.start_date < p.end_date AND l.end_date >= p.start_date)::int AS pending_requests,
       (SELECT COUNT(*) FROM leaves l, period p WHERE l.employee_id = e.id AND l.status = 'rejected'
          AND l.start_date < p.end_date AND l.end_date >= p.start_date)::int AS rejected_requests
     FROM employees e
     LEFT JOIN attendance a ON a.employee_id = e.id
       AND a.work_date >= (SELECT start_date FROM period) AND a.work_date < (SELECT end_date FROM period)
     WHERE e.manager_id = $1 AND e.is_active
     GROUP BY e.id ORDER BY e.name`, [req.user.id, year, month]);
  res.json({ month, year, members: rows });
}));

module.exports = router;
