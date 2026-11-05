const router = require('express').Router();
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate } = require('../middleware/auth');
const { ESCALATE_AFTER_DAYS } = require('../utils/workflowPolicy');

router.use(authenticate);

const count = async (sql, params = []) => (await pool.query(sql, params)).rows[0].n;

// GET /api/notifications - what is waiting on the signed-in person right now.
// The web app polls this to show live badges. Counts only: no names or amounts leave this route.
router.get('/', asyncHandler(async (req, res) => {
  const id = req.user.id;
  let counts = {};

  if (req.user.role === 'manager') {
    const [leave, credit, attendance, drafts, publish] = await Promise.all([
      count(`SELECT COUNT(*)::int AS n FROM leaves l JOIN employees e ON e.id = l.employee_id
             WHERE e.manager_id = $1 AND e.is_active AND l.status = 'pending'`, [id]),
      count(`SELECT COUNT(*)::int AS n FROM advances a JOIN employees e ON e.id = a.employee_id
             WHERE e.manager_id = $1 AND e.is_active AND a.status = 'pending' AND a.manager_decision IS NULL`, [id]),
      count(`SELECT COUNT(*)::int AS n FROM attendance_requests r JOIN employees e ON e.id = r.employee_id
             WHERE e.manager_id = $1 AND e.is_active AND r.status = 'pending'`, [id]),
      count(`SELECT COUNT(*)::int AS n FROM payslips p JOIN employees e ON e.id = p.employee_id
             WHERE e.manager_id = $1 AND p.status = 'draft'`, [id]),
      count(`SELECT COUNT(*)::int AS n FROM payslips p JOIN employees e ON e.id = p.employee_id
             WHERE e.manager_id = $1 AND p.status = 'finalized' AND p.published_at IS NULL`, [id]),
    ]);
    counts = { leave_pending: leave, credit_pending: credit, attendance_requests_pending: attendance,
      payroll_drafts: drafts, payroll_to_publish: publish };
  } else if (req.user.role === 'admin') {
    // Anything with a manager is that manager's to decide first, until it has waited too long.
    const waiting = `(e.manager_id IS NULL OR (CURRENT_DATE - %COLUMN%::date) >= $1)`;
    const [leave, loans, advances, attendance, awaiting, publish] = await Promise.all([
      count(`SELECT COUNT(*)::int AS n FROM leaves l JOIN employees e ON e.id = l.employee_id
             WHERE l.status = 'pending' AND ${waiting.replace('%COLUMN%', 'l.applied_at')}`, [ESCALATE_AFTER_DAYS]),
      count(`SELECT COUNT(*)::int AS n FROM advances a JOIN employees e ON e.id = a.employee_id
             WHERE a.record_type = 'loan' AND a.status = 'pending'
               AND (e.manager_id IS NULL OR a.manager_decision IS NOT NULL OR (CURRENT_DATE - a.created_at::date) >= $1)`, [ESCALATE_AFTER_DAYS]),
      count(`SELECT COUNT(*)::int AS n FROM advances a JOIN employees e ON e.id = a.employee_id
             WHERE a.record_type = 'salary_advance' AND a.status = 'pending'
               AND (e.manager_id IS NULL OR a.manager_decision IS NOT NULL OR (CURRENT_DATE - a.created_at::date) >= $1)`, [ESCALATE_AFTER_DAYS]),
      count(`SELECT COUNT(*)::int AS n FROM attendance_requests r JOIN employees e ON e.id = r.employee_id
             WHERE r.status = 'pending' AND ${waiting.replace('%COLUMN%', 'r.created_at')}`, [ESCALATE_AFTER_DAYS]),
      count(`SELECT COUNT(*)::int AS n FROM payslips WHERE status = 'submitted'`),
      count(`SELECT COUNT(*)::int AS n FROM payslips p JOIN employees e ON e.id = p.employee_id
             WHERE p.status = 'finalized' AND p.published_at IS NULL AND e.manager_id IS NULL`),
    ]);
    counts = { leave_pending: leave, loans_pending: loans, advances_pending: advances,
      attendance_requests_pending: attendance, payroll_awaiting_approval: awaiting, payroll_to_publish: publish };
  }

  res.json({ role: req.user.role, counts, escalate_after_days: ESCALATE_AFTER_DAYS });
}));

module.exports = router;
