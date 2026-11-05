const router = require('express').Router();
const pool = require('../config/db');
const { LOCK } = require('../utils/loanRecovery');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { receiveLeaveDocuments } = require('../utils/leaveDocuments');
const { ESCALATE_AFTER_DAYS } = require('../utils/workflowPolicy');

router.use(authenticate);

const TYPES = ['casual', 'sick', 'paid'];

const isDate = (v) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v || '');

const COLS = `
  l.id,
  l.employee_id,
  l.leave_type,
  l.start_date::text AS start_date,
  l.end_date::text AS end_date,
  l.reason,
  l.status,
  l.rejection_reason,
  l.decided_at,
  (SELECT name FROM employees WHERE id = l.decided_by) AS decided_by_name,
  (SELECT m.name FROM employees e JOIN employees m ON m.id = e.manager_id WHERE e.id = l.employee_id) AS manager_name,
  (CURRENT_DATE - l.applied_at::date)::int AS waiting_days,
  (l.status = 'pending' AND EXISTS (SELECT 1 FROM employees x WHERE x.id = l.employee_id AND x.manager_id IS NOT NULL)
    AND (CURRENT_DATE - l.applied_at::date) >= ${ESCALATE_AFTER_DAYS}) AS escalated,
  COALESCE((
    SELECT json_agg(json_build_object(
      'id', d.id, 'filename', d.filename, 'mime_type', d.mime_type, 'size_bytes', d.size_bytes
    ) ORDER BY d.id)
    FROM leave_documents d WHERE d.leave_id = l.id
  ), '[]'::json) AS medical_documents
`;

// GET /api/leaves/my
// Employee: view their own leave requests
router.get(
  '/my',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${COLS}
       FROM leaves l
       WHERE l.employee_id = $1
       ORDER BY l.start_date DESC`,
      [req.user.id]
    );

    res.json(rows);
  })
);

// POST /api/leaves
// Employee: create a leave request
// Body:
// {
//   leave_type,
//   start_date,
//   end_date,
//   reason
// }
// Also accepts multipart/form-data with optional medical_documents files.
router.post(
  '/',
  authorize('employee', 'manager'),
  receiveLeaveDocuments,
  asyncHandler(async (req, res) => {
    const {
      leave_type,
      start_date,
      end_date,
      reason
    } = req.body || {};

    if (!TYPES.includes(leave_type)) {
      return res.status(400).json({
        message: 'Invalid leave type'
      });
    }

    if (
      !isDate(start_date) ||
      !isDate(end_date)
    ) {
      return res.status(400).json({
        message:
          'Valid start and end dates are required'
      });
    }

    if (end_date < start_date) {
      return res.status(400).json({
        message:
          'End date cannot be before start date'
      });
    }

    if (typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({
        message: 'Reason is required'
      });
    }

    // Prevent overlapping pending/approved leave.
    const overlap = await pool.query(
      `SELECT 1
       FROM leaves
       WHERE employee_id = $1
         AND status IN ('pending', 'approved')
         AND start_date <= $3
         AND end_date >= $2
       LIMIT 1`,
      [
        req.user.id,
        start_date,
        end_date
      ]
    );

    if (overlap.rowCount) {
      return res.status(409).json({
        message:
          'You already have a leave request in these dates'
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(LOCK);
      const { rows } = await client.query(
        `INSERT INTO leaves (
          employee_id,
          leave_type,
          start_date,
          end_date,
          reason
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          employee_id,
          leave_type,
          start_date::text AS start_date,
          end_date::text AS end_date,
          reason,
          status`,
        [
          req.user.id,
          leave_type,
          start_date,
          end_date,
          reason.trim()
        ]
      );

      const medicalDocuments = [];
      for (const file of req.files || []) {
        const document = await client.query(
          `INSERT INTO leave_documents (leave_id, filename, mime_type, size_bytes, content)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, filename, mime_type, size_bytes`,
          [rows[0].id, file.originalname, file.mimetype, file.size, file.buffer]
        );
        medicalDocuments.push(document.rows[0]);
      }
      await client.query('COMMIT');
      res.status(201).json({ ...rows[0], medical_documents: medicalDocuments });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })
);

// Document contents are served only to the submitting employee or an admin.
router.get(
  '/:id/documents/:documentId',
  asyncHandler(async (req, res) => {
    if (![req.params.id, req.params.documentId].every((id) => /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) <= 2147483647)) {
      return res.status(400).json({ message: 'Invalid leave or document ID' });
    }
    const { rows } = await pool.query(
      `SELECT d.filename, d.mime_type, d.content
       FROM leave_documents d JOIN leaves l ON l.id = d.leave_id
       WHERE d.id = $1 AND l.id = $2
         AND ($3::boolean OR l.employee_id = $4
              OR l.employee_id IN (SELECT id FROM employees WHERE manager_id = $4))`,
      [req.params.documentId, req.params.id, req.user.role === 'admin', req.user.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ message: 'Medical document not found' });
    }
    res.attachment(rows[0].filename);
    res.set({
      'Content-Type': rows[0].mime_type,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.send(rows[0].content);
  })
);

// GET /api/leaves/team?status=pending
// Manager: view leave requests from direct reports
router.get(
  '/team',
  authorize('manager'),
  asyncHandler(async (req, res) => {
    const vals = [req.user.id];
    let statusFilter = '';

    if (req.query.status) {
      vals.push(req.query.status);
      statusFilter = 'AND l.status = $2';
    }

    const { rows } = await pool.query(
      `SELECT
        ${COLS},
        e.name,
        e.name AS employee_name,
        e.emp_code
       FROM leaves l
       JOIN employees e ON e.id = l.employee_id
       WHERE e.manager_id = $1
         AND e.is_active
         ${statusFilter}
       ORDER BY
         (l.status = 'pending') DESC,
         l.start_date DESC`,
      vals
    );

    res.json(rows);
  })
);

// GET /api/leaves?status=pending
// Admin: view all leave requests
router.get(
  '/',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const vals = [];
    let where = '';

    if (req.query.status) {
      vals.push(req.query.status);
      where = 'WHERE l.status = $1';
    }

    const { rows } = await pool.query(
      `SELECT
        ${COLS},
        e.name,
        e.name AS employee_name,
        e.emp_code
       FROM leaves l
       JOIN employees e
         ON e.id = l.employee_id
       ${where}
       ORDER BY
         (l.status = 'pending') DESC,
         l.start_date DESC`,
      vals
    );

    res.json(rows);
  })
);

// PATCH /api/leaves/:id/status
// Admin: approve or reject any pending leave request.
// Manager: the same, limited to requests from their direct reports.
// Body:
// {
//   status: 'approved' | 'rejected',
//   rejection_reason: required when rejecting
// }
router.patch(
  '/:id/status',
  authorize('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const { status, rejection_reason } = req.body || {};

    if (
      !['approved', 'rejected'].includes(status)
    ) {
      return res.status(400).json({
        message:
          'status must be approved or rejected'
      });
    }

    const rejectionReason = typeof rejection_reason === 'string'
      ? rejection_reason.trim()
      : '';

    if (status === 'rejected' && !rejectionReason) {
      return res.status(400).json({
        message: 'A rejection reason is required'
      });
    }

    if (!/^\d+$/.test(req.params.id) || Number(req.params.id) > 2147483647) {
      return res.status(400).json({ message: 'Invalid leave ID' });
    }

    // Managers may only decide requests from their own team; requests outside
    // it are reported as not found so their existence is not disclosed.
    if (req.user.role === 'manager') {
      const inTeam = await pool.query(
        `SELECT 1 FROM leaves l JOIN employees e ON e.id = l.employee_id
         WHERE l.id = $1 AND e.manager_id = $2`,
        [req.params.id, req.user.id]
      );
      if (!inTeam.rowCount) {
        return res.status(404).json({ message: 'Leave not found' });
      }
      // Approving leave rewrites attendance, so a manager cannot do it for a month whose payroll is finalized.
      if (status === 'approved') {
        const locked = await pool.query(
          `SELECT 1 FROM leaves l JOIN payslips p ON p.employee_id = l.employee_id AND p.status = 'finalized'
             AND make_date(p.year, p.month, 1) <= l.end_date
             AND make_date(p.year, p.month, 1) + interval '1 month' > l.start_date
           WHERE l.id = $1`, [req.params.id]);
        if (locked.rowCount) {
          return res.status(409).json({ message: 'Payroll for part of this leave is finalized. Ask an administrator to decide it.' });
        }
      }
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(LOCK);

      const { rows } = await client.query(
        `UPDATE leaves
         SET status = $1, rejection_reason = $3,
             decided_by = $4, decided_at = NOW()
         WHERE id = $2
           AND status = 'pending'
         RETURNING *`,
        [
          status,
          req.params.id,
          status === 'rejected' ? rejectionReason : null,
          req.user.id
        ]
      );

      const leave = rows[0];

      if (!leave) {
        await client.query('ROLLBACK');

        const exists = await pool.query(
          `SELECT status
           FROM leaves
           WHERE id = $1`,
          [req.params.id]
        );

        if (exists.rowCount) {
          return res.status(409).json({
            message:
              `This request is already ${exists.rows[0].status}`
          });
        }

        return res.status(404).json({
          message: 'Leave not found'
        });
      }

      // If approved, mark all dates as leave
      // in the attendance table.
      if (status === 'approved') {
        await client.query(
          `INSERT INTO attendance (
            employee_id,
            work_date,
            status,
            day_type,
            note,
            marked_by,
            marked_at
          )
          SELECT
            $1,
            d::date,
            $5,
            'full',
            $4,
            $6,
            NOW()
          FROM generate_series(
            $2::date,
            $3::date,
            interval '1 day'
          ) d
          ON CONFLICT (
            employee_id,
            work_date
          )
          DO UPDATE SET
            status = EXCLUDED.status,
            day_type = 'full',
            note = EXCLUDED.note,
            marked_by = EXCLUDED.marked_by,
            marked_at = EXCLUDED.marked_at`,
          [
            leave.employee_id,
            leave.start_date,
            leave.end_date,
            `${leave.leave_type} leave (approved)`,
            leave.leave_type === 'paid' ? 'paid_leave' : 'leave',
            req.user.id
          ]
        );
      }

      await client.query('COMMIT');

      res.json({
        id: leave.id,
        status: leave.status,
        rejection_reason: leave.rejection_reason
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
