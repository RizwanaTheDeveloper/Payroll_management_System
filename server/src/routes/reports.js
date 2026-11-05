const router = require('express').Router();
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { attendanceWithLeavePolicy } = require('../utils/leavePolicy');

router.use(authenticate);

// Return only reporting fields, with period-bounded records and one consistent snapshot.
async function getReport(req, res, employeeId = null) {
  const period = String(req.query.period || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)
      || Number(period.slice(0, 4)) < 2000 || Number(period.slice(0, 4)) > 2100) {
    return res.status(400).json({ message: 'A valid period (YYYY-MM) is required' });
  }
  const start = `${period}-01`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const employees = await client.query(`SELECT id, emp_code, name,
      COALESCE(NULLIF(department, ''), 'Unassigned') AS department,
      designation, is_active, joining_date::text, resignation_date::text
      FROM employees WHERE role IN ('employee', 'manager') AND ($1::int IS NULL OR id = $1) ORDER BY name`, [employeeId]);
    const payslips = await client.query(`SELECT p.*, p.paid_on::text,
      COALESCE((SELECT SUM(r.amount) FROM advance_recoveries r JOIN advances a ON a.id = r.advance_id
        WHERE r.payslip_id = p.id AND a.record_type = 'loan'), 0) AS loan_recovery
      FROM payslips p WHERE make_date(p.year, p.month, 1) >= $1::date - interval '1 month'
        AND make_date(p.year, p.month, 1) < $1::date + interval '1 month'
        AND ($2::int IS NULL OR (p.employee_id = $2 AND p.published_at IS NOT NULL))
      ORDER BY p.year, p.month, p.employee_id`, [start, employeeId]);
    const attendance = await client.query(`${attendanceWithLeavePolicy}
      SELECT id, employee_id, work_date::text, status, recorded_status, day_type, note,
        check_in::text, check_out::text,
        CASE WHEN check_out >= check_in THEN EXTRACT(EPOCH FROM (check_out - check_in)) / 3600
             ELSE NULL END AS worked_hours
      FROM policy_attendance WHERE work_date >= $1::date
        AND work_date < $1::date + interval '1 month' AND ($2::int IS NULL OR employee_id = $2)
        ORDER BY work_date, employee_id`, [start, employeeId]);
    const leaves = await client.query(`SELECT id, employee_id, leave_type, start_date::text,
      end_date::text, reason, status, rejection_reason,
      (LEAST(end_date, ($1::date + interval '1 month' - interval '1 day')::date)
       - GREATEST(start_date, $1::date) + 1) AS period_days
      FROM leaves WHERE start_date < $1::date + interval '1 month' AND end_date >= $1::date
        AND ($2::int IS NULL OR employee_id = $2)
      ORDER BY start_date, employee_id`, [start, employeeId]);
    const loans = await client.query(`SELECT a.id, a.employee_id, a.amount, a.instalment, a.record_type,
      a.interest_percentage, a.instalment_count, a.status, a.first_recovery::text,
      a.disbursed_on::text, a.created_at::text,
      a.amount + ROUND(a.amount * a.interest_percentage / 100, 2) * COALESCE(a.instalment_count, 1) AS total_repayable,
      COALESCE(SUM(r.amount) FILTER (WHERE make_date(p.year, p.month, 1) < $1::date + interval '1 month'), 0) AS recovered,
      COALESCE(SUM(r.amount) FILTER (WHERE p.year = EXTRACT(YEAR FROM $1::date)
        AND p.month = EXTRACT(MONTH FROM $1::date)), 0) AS period_recovered
      FROM advances a LEFT JOIN advance_recoveries r ON r.advance_id = a.id
      LEFT JOIN payslips p ON p.id = r.payslip_id
      WHERE a.created_at < $1::date + interval '1 month'
        AND ($2::int IS NULL OR a.employee_id = $2)
      GROUP BY a.id ORDER BY a.employee_id, a.id`, [start, employeeId]);
    const audit = await client.query(`SELECT v.id, a.employee_id, a.record_type, v.advance_id, v.action, v.note,
      v.created_at::text, COALESCE(actor.name, 'Deleted user') AS actor
      FROM advance_events v JOIN advances a ON a.id = v.advance_id
      LEFT JOIN employees actor ON actor.id = v.actor_id
      WHERE v.created_at >= $1::date AND v.created_at < $1::date + interval '1 month'
        AND ($2::int IS NULL OR a.employee_id = $2)
      ORDER BY v.created_at DESC`, [start, employeeId]);
    const payrollAudit = await client.query(`SELECT v.id, v.employee_id, v.action, v.reason, v.created_at::text,
      COALESCE(e.name, 'System') AS actor FROM payroll_events v LEFT JOIN employees e ON e.id = v.actor_id
      WHERE v.month = EXTRACT(MONTH FROM $1::date) AND v.year = EXTRACT(YEAR FROM $1::date)
        AND ($2::int IS NULL OR v.employee_id = $2)
      ORDER BY v.created_at DESC, v.id DESC`, [start, employeeId]);
    await client.query('COMMIT');
    res.json({ period, generated_at: new Date().toISOString(), employees: employees.rows,
      payslips: payslips.rows, attendance: attendance.rows, leaves: leaves.rows,
      loans: loans.rows, audit: audit.rows, payroll_audit: payrollAudit.rows });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

router.get('/my', authorize('employee', 'manager'), asyncHandler((req, res) => getReport(req, res, req.user.id)));
router.get('/', authorize('admin'), asyncHandler((req, res) => getReport(req, res)));

module.exports = router;
