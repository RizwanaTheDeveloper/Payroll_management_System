const router = require('express').Router();

const pool = require('../config/db');

const asyncHandler = require('../utils/asyncHandler');

const {
  authenticate,
  authorize,
} = require('../middleware/auth');

const generatePayslipPdf =
  require('../utils/payslipPdf');

router.use(authenticate);

// =========================================================
// HELPERS
// =========================================================

// =========================================================
// EMPLOYEE - MY PAYSLIPS
// =========================================================

router.get(
  '/my',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        month,
        year,

        -- Earnings
        basic,
        hra,
        special_allowance,
        lta,
        other_allowances,
        allowances,

        -- Deductions
        epf,
        professional_tax,
        advance,
        deductions,

        -- Final
        net_pay, status, payment_status, paid_on, payment_reference, unpaid_leave_deduction, additional_deductions, late_login_deduction, late_login_count, late_login_reason, month_days, employed_days, net_paid_days,
        jsonb_array_length(p.calculation_snapshot -> 'unpaid_dates') AS unpaid_leave_days,
        COALESCE((SELECT json_agg(json_build_object('advance_id', r.advance_id, 'amount', r.amount, 'record_type', a.record_type) ORDER BY r.advance_id)
          FROM advance_recoveries r JOIN advances a ON a.id = r.advance_id WHERE r.payslip_id = p.id), '[]'::json) AS advance_recoveries

      FROM payslips p

      WHERE employee_id = $1
        AND published_at IS NOT NULL

      ORDER BY
        year DESC,
        month DESC
      `,
      [req.user.id]
    );

    res.json(rows);
  })
);

// =========================================================
// ADMIN - VIEW PAYSLIPS
// =========================================================

router.get(
  '/',
  authorize('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const {
      month,
      year,
      employee_id,
    } = req.query;

    const where = [];
    const vals = [];

    if (req.user.role === 'manager') {
      vals.push(req.user.id);
      where.push(`e.manager_id = $${vals.length}`);
    }

    if (month) {
      vals.push(month);

      where.push(
        `p.month = $${vals.length}`
      );
    }

    if (year) {
      vals.push(year);

      where.push(
        `p.year = $${vals.length}`
      );
    }

    if (employee_id) {
      vals.push(employee_id);

      where.push(
        `p.employee_id = $${vals.length}`
      );
    }

    const { rows } =
      await pool.query(
        `
        SELECT
          p.*,
          jsonb_array_length(p.calculation_snapshot -> 'unpaid_dates') AS unpaid_leave_days,
          e.name,
          e.emp_code,
          COALESCE((SELECT json_agg(json_build_object('advance_id', r.advance_id, 'amount', r.amount, 'record_type', a.record_type))
            FROM advance_recoveries r JOIN advances a ON a.id = r.advance_id WHERE r.payslip_id = p.id), '[]'::json) AS advance_recoveries

        FROM payslips p

        JOIN employees e
          ON e.id = p.employee_id

        ${
          where.length
            ? 'WHERE ' + where.join(' AND ')
            : ''
        }

        ORDER BY
          p.year DESC,
          p.month DESC,
          e.name
        `,
        vals
      );

    res.json(rows);
  })
);

router.use(require('./payrollWorkflow'));

// =========================================================
// DOWNLOAD PAYSLIP PDF
// =========================================================
//
// Admin:
//   Can download any payslip.
//
// Employee:
//   Can download only their own payslip.
// =========================================================

router.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const isAdmin =
      req.user?.role === 'admin';

    const queryValues = isAdmin
      ? [req.params.id]
      : [
          req.params.id,
          req.user.id,
        ];

    const whereClause = isAdmin
      ? 'p.id = $1'
      : `
        p.id = $1
        AND p.employee_id = $2
        AND p.published_at IS NOT NULL
      `;

    const { rows } =
      await pool.query(
        `
        SELECT
          p.*,

          -- Employee information
          COALESCE((SELECT json_agg(json_build_object('advance_id', r.advance_id, 'amount', r.amount, 'record_type', a.record_type) ORDER BY r.advance_id)
            FROM advance_recoveries r JOIN advances a ON a.id = r.advance_id WHERE r.payslip_id = p.id), '[]'::json) AS advance_recoveries,
          e.name,
          e.email,
          e.designation,
          e.emp_code,
          e.gender,
          e.dob::text AS dob,
          e.pan,
          e.pf_uan,
          e.bank_name,
          e.bank_branch,
          e.account_number,
          e.ifsc_code,
          e.tax_regime,
          e.joining_date::text AS joining_date,
          e.resignation_date::text AS resignation_date,
          e.is_active

        FROM payslips p

        JOIN employees e
          ON e.id = p.employee_id

        WHERE ${whereClause}
        `,
        queryValues
      );

    if (!rows.length) {
      return res.status(404).json({
        message:
          'Payslip not found',
      });
    }

    const payslip = rows[0];

    // ---------------------------------------------------
    // NORMALIZE DATE VALUES
    // ---------------------------------------------------

    payslip.dob =
      payslip.dob
        ? String(payslip.dob).slice(0, 10)
        : '';

    payslip.joining_date =
      payslip.joining_date
        ? String(
            payslip.joining_date
          ).slice(0, 10)
        : '';

    payslip.resignation_date =
      payslip.resignation_date
        ? String(
            payslip.resignation_date
          ).slice(0, 10)
        : '';

    // ---------------------------------------------------
    // COMPATIBILITY FIELDS FOR PDF GENERATOR
    // ---------------------------------------------------

    payslip.account_number =
      payslip.account_number || '';

    payslip.bank_name = payslip.bank_name || '';
    payslip.bank_branch = payslip.bank_branch || '';

    payslip.uan =
      payslip.pf_uan || '';

    payslip.month_days = payslip.month_days || new Date(Date.UTC(payslip.year, payslip.month, 0)).getUTCDate();

    payslip.net_paid_days = payslip.net_paid_days ?? null;

    // ---------------------------------------------------
    // GENERATE PDF
    // ---------------------------------------------------

    return generatePayslipPdf(
      res,
      payslip
    );
  })
);

module.exports = router;
