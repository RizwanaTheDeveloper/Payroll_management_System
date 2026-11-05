const router = require('express').Router();
const bcrypt = require('bcrypt');

const { destroyEmployeeSessions } = require('../utils/session');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { amount } = require('../utils/payrollValidation');
const { baseline, recordChange } = require('../utils/salaryHistory');
const { LOCK } = require('../utils/loanRecovery');
const {
  authenticate,
  authorize
} = require('../middleware/auth');

router.use(
  authenticate,
  authorize('admin')
);


// =========================================================
// FIELD DEFINITIONS
// =========================================================

const TEXT = [
  'emp_code',
  'name',
  'designation',
  'department',
  'gender',
  'pan',
  'pf_uan',
  'bank_name',
  'bank_branch',
  'account_number',
  'ifsc_code'
];

const DATES = [
  'dob',
  'joining_date',
  'resignation_date'
];

const NUMS = [
  'ctc',
  'advance',

  // Earnings
  'basic',
  'hra',
  'special_allowance',
  'lta',
  'other_allowances',

  // Deductions
  'epf',
  'professional_tax'
];


// =========================================================
// HELPERS
// =========================================================

const isDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value || '');


const OUT = `
  id,
  emp_code,
  name,
  email,
  role,
  manager_id,
  must_change_password,
  designation,
  department,
  gender,

  dob::text AS dob,

  ctc,
  advance,

  pan,
  pf_uan,

  account_number,
  bank_name,
  bank_branch,
  ifsc_code,

  tax_regime,

  joining_date::text AS joining_date,
  resignation_date::text AS resignation_date,

  basic,
  hra,
  special_allowance,
  lta,
  other_allowances,

  epf,
  professional_tax,

  is_active
`;


// =========================================================
// CLEAN / VALIDATE INPUT
// =========================================================

function clean(body) {

  const values = {};


  // -------------------------------------------------------
  // TEXT
  // -------------------------------------------------------

  for (const key of TEXT) {

    if (!(key in body)) {
      continue;
    }

    let value =
      body[key] == null
        ? ''
        : String(body[key]).trim();


    if (
      [
        'emp_code',
        'pan',
        'ifsc_code'
      ].includes(key)
    ) {
      value = value.toUpperCase();
    }


    values[key] = value || null;
  }


  // -------------------------------------------------------
  // DATES
  // -------------------------------------------------------

  for (const key of DATES) {

    if (!(key in body)) {
      continue;
    }

    const value = body[key] || null;


    if (
      value &&
      !isDate(
        String(value).slice(0, 10)
      )
    ) {
      return {
        error: `Invalid ${key}`
      };
    }


    values[key] = value
      ? String(value).slice(0, 10)
      : null;
  }


  // -------------------------------------------------------
  // NUMERIC FIELDS
  // -------------------------------------------------------

  for (const key of NUMS) {

    if (!(key in body)) {
      continue;
    }

    if (
      key === 'advance' &&
      (body[key] === '' || body[key] === null)
    ) {
      values[key] = null;
      continue;
    }

    let number;
    try { number = amount(body[key], key); }
    catch (error) { return { error: error.message }; }


    if (number < 0) {

      return {
        error:
          'Salary components must be zero or more'
      };
    }


    values[key] = number;
  }


  // -------------------------------------------------------
  // ROLE AND MANAGER
  // -------------------------------------------------------

  if ('role' in body) {
    if (!['employee', 'manager'].includes(body.role)) {
      return { error: 'role must be employee or manager' };
    }
    values.role = body.role;
  }

  if ('manager_id' in body) {
    const raw = body.manager_id;
    if (raw === '' || raw === null) {
      values.manager_id = null;
    } else if (!/^\d+$/.test(String(raw)) || Number(raw) > 2147483647) {
      return { error: 'Invalid manager' };
    } else {
      values.manager_id = Number(raw);
    }
  }


  // -------------------------------------------------------
  // TAX REGIME
  // -------------------------------------------------------

  if ('tax_regime' in body) {

    if (
      !['new', 'old'].includes(
        body.tax_regime
      )
    ) {

      return {
        error:
          'tax_regime must be new or old'
      };
    }


    values.tax_regime =
      body.tax_regime;
  }


  // -------------------------------------------------------
  // REQUIRED / FORMAT VALIDATION
  // -------------------------------------------------------

  if (
    'name' in values &&
    !values.name
  ) {

    return {
      error: 'Name is required'
    };
  }


  if (
    values.pan &&
    !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(
      values.pan
    )
  ) {

    return {
      error:
        'PAN must look like ABCDE1234F'
    };
  }


  if (
    values.pf_uan &&
    !/^\d{12}$/.test(
      values.pf_uan
    )
  ) {

    return {
      error:
        'PF UAN must be 12 digits'
    };
  }


  if (
    values.account_number &&
    !/^\d{9,18}$/.test(
      values.account_number
    )
  ) {

    return {
      error:
        'Account number must be 9 to 18 digits'
    };
  }


  if (
    values.ifsc_code &&
    !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(
      values.ifsc_code
    )
  ) {

    return {
      error:
        'IFSC must look like SBIN0001234'
    };
  }


  if (
    values.joining_date &&
    values.resignation_date &&
    values.resignation_date <
      values.joining_date
  ) {

    return {
      error:
        'Resignation date cannot be before joining date'
    };
  }


  return {
    values
  };
}


// =========================================================
// DUPLICATE ERROR
// =========================================================

const dupMessage = (error) => {

  if (
    error.constraint &&
    error.constraint.includes(
      'emp_code'
    )
  ) {

    return 'Employee ID already exists';
  }


  return 'Email already exists';
};


// =========================================================
// GET EMPLOYEE STATS
// =========================================================

router.get(
  '/stats',
  asyncHandler(
    async (req, res) => {

      const {
        rows
      } = await pool.query(`
        WITH today AS (
          SELECT
            (
              now()
              AT TIME ZONE 'Asia/Kolkata'
            )::date AS d
        )

        SELECT

          (
            SELECT COUNT(*)
            FROM employees
            WHERE role IN ('employee', 'manager')
              AND is_active
          )::int AS "headcount",

          (
            SELECT COUNT(*)
            FROM leaves
            WHERE status = 'pending'
          )::int AS "pendingLeaves",

          (
            SELECT COUNT(*)
            FROM attendance a,
                 today t

            WHERE a.work_date = t.d
              AND a.status = 'present'
          )::int AS "presentToday",

          (
            SELECT COALESCE(
              SUM(net_pay),
              0
            )

            FROM payslips p,
                 today t

            WHERE p.month =
              EXTRACT(
                MONTH FROM t.d
              )

              AND p.year =
              EXTRACT(
                YEAR FROM t.d
              )
          ) AS "monthlyPayroll"
      `);


      res.json(rows[0]);
    }
  )
);


// =========================================================
// GET EMPLOYEES
// =========================================================

router.get(
  '/',
  asyncHandler(
    async (req, res) => {

      const roleFilter =
        req.query.all
          ? ''
          : "AND role IN ('employee', 'manager')";


      const {
        rows
      } = await pool.query(
        `
        SELECT ${OUT}

        FROM employees

        WHERE ${req.query.include_inactive === 'true' ? 'TRUE' : 'is_active'}
        ${roleFilter}

        ORDER BY name
        `
      );


      res.json(rows);
    }
  )
);


// Database-backed checks for the manager role and reporting line.
async function teamError(values, selfId) {
  if (values.manager_id != null) {
    if (selfId && Number(selfId) === values.manager_id) {
      return 'An employee cannot be their own manager';
    }
    const { rows } = await pool.query(
      `SELECT manager_id FROM employees WHERE id = $1 AND role = 'manager' AND is_active`,
      [values.manager_id]
    );
    if (!rows[0]) return 'Selected manager must be an active manager';
    if (selfId && rows[0].manager_id === Number(selfId)) {
      return 'Reporting lines cannot be circular';
    }
  }
  if (selfId && values.role === 'employee') {
    const { rowCount } = await pool.query(
      'SELECT 1 FROM employees WHERE manager_id = $1 AND is_active LIMIT 1',
      [selfId]
    );
    if (rowCount) return 'Reassign this team before changing the manager to an employee';
  }
  return null;
}


// =========================================================
// CREATE EMPLOYEE
// =========================================================

async function writeEmployee(sql, params, body, actorId, create = false) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(LOCK);
    const before = create ? null : (await client.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [params[params.length - 1]])).rows[0];
    const result = await client.query(sql, params);
    if (result.rows[0]) {
      if (create) await baseline(client, result.rows[0], actorId);
      else if (before) await recordChange(client, before, result.rows[0], body, actorId);
      result.rows = (await client.query(`SELECT ${OUT} FROM employees WHERE id = $1`, [result.rows[0].id])).rows;
    }
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

router.get('/:id/salary-history', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`SELECT h.*, h.effective_from::text, COALESCE(e.name, 'System') AS changed_by
    FROM salary_history h LEFT JOIN employees e ON e.id = h.actor_id
    WHERE h.employee_id = $1 ORDER BY h.effective_from DESC`, [req.params.id]);
  res.json(rows);
}));

router.post(
  '/',
  asyncHandler(
    async (req, res) => {

      const body =
        req.body || {};


      const {
        values,
        error
      } = clean(body);


      if (error) {

        return res
          .status(400)
          .json({
            message: error
          });
      }


      const teamProblem = await teamError(values, null);
      if (teamProblem) {
        return res.status(400).json({ message: teamProblem });
      }

      const role = values.role || 'employee';
      delete values.role;

      const email =
        (body.email || '')
          .trim()
          .toLowerCase();


      // ---------------------------------------------------
      // REQUIRED FIELDS
      // ---------------------------------------------------

      if (!values.emp_code) {

        return res
          .status(400)
          .json({
            message:
              'Employee ID is required'
          });
      }


      if (!values.name) {

        return res
          .status(400)
          .json({
            message:
              'Name is required'
          });
      }


      if (
        !email ||
        !body.password
      ) {

        return res
          .status(400)
          .json({
            message:
              'Email and password are required'
          });
      }


      if (!values.designation) {

        return res
          .status(400)
          .json({
            message:
              'Designation is required'
          });
      }


      if (!values.gender) {

        return res
          .status(400)
          .json({
            message:
              'Gender is required'
          });
      }


      if (!values.dob) {

        return res
          .status(400)
          .json({
            message:
              'Date of birth is required'
          });
      }


      if (String(body.password).length < 8) {
        return res.status(400).json({ message: 'Temporary password must be at least 8 characters' });
      }

      // ---------------------------------------------------
      // PASSWORD HASH
      // ---------------------------------------------------

      const hash =
        await bcrypt.hash(
          body.password,
          10
        );


      const keys =
        Object.keys(values);


      const cols = [
        'email',
        'password_hash',
        'role',
        'must_change_password',
        ...keys
      ];


      const params = [
        email,
        hash,
        role,
        // The password the administrator sets is temporary unless they opt out.
        body.require_password_change !== false,
        ...keys.map(
          (key) =>
            values[key]
        )
      ];


      try {

        const {
          rows
        } = await writeEmployee(

          `
          INSERT INTO employees (
            ${cols.join(',')}
          )

          VALUES (
            ${cols
              .map(
                (_, index) =>
                  `$${index + 1}`
              )
              .join(',')}
          )

          RETURNING ${OUT}
          `,

          params, body, req.user.id, true
        );


        res
          .status(201)
          .json(rows[0]);

      } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });

        if (
          error.code === '23505'
        ) {

          return res
            .status(409)
            .json({
              message:
                dupMessage(error)
            });
        }


        throw error;
      }
    }
  )
);


// =========================================================
// UPDATE EMPLOYEE
// =========================================================

router.put(
  '/:id',
  asyncHandler(
    async (req, res) => {

      const body =
        req.body || {};


      const {
        values,
        error
      } = clean(body);


      if (error) {

        return res
          .status(400)
          .json({
            message: error
          });
      }


      const teamProblem = await teamError(values, req.params.id);
      if (teamProblem) {
        return res.status(400).json({ message: teamProblem });
      }


      const keys =
        Object.keys(values);


      const sets =
        keys.map(
          (key, index) =>
            `${key} = $${index + 1}`
        );


      const params =
        keys.map(
          (key) =>
            values[key]
        );


      // ---------------------------------------------------
      // EMAIL (the login ID) - previously ignored on update
      // ---------------------------------------------------

      if (body.email !== undefined) {
        const nextEmail = String(body.email || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nextEmail)) {
          return res.status(400).json({ message: 'Enter a valid email address' });
        }
        params.push(nextEmail);
        sets.push(`email = $${params.length}`);
      }


      // ---------------------------------------------------
      // OPTIONAL PASSWORD
      // ---------------------------------------------------

      if (body.password) {

        if (String(body.password).length < 8) {
          return res.status(400).json({ message: 'Password must be at least 8 characters' });
        }

        params.push(
          await bcrypt.hash(
            body.password,
            10
          )
        );


        sets.push(
          `password_hash = $${params.length}`
        );

        // An administrator-set password is temporary: the employee must replace it at next sign-in.
        params.push(body.require_password_change !== false);

        sets.push(
          `must_change_password = $${params.length}`
        );
      }


      if (!sets.length) {

        return res
          .status(400)
          .json({
            message:
              'Nothing to update'
          });
      }


      params.push(
        req.params.id
      );


      try {

        const {
          rows
        } = await writeEmployee(

          `
          UPDATE employees

          SET ${sets.join(', ')}

          WHERE id = $${params.length}

            AND role IN ('employee', 'manager')

          RETURNING ${OUT}
          `,

          params, body, req.user.id
        );


        if (!rows[0]) {

          return res
            .status(404)
            .json({
              message:
                'Employee not found'
            });
        }


        // A password reset by an administrator signs the employee out everywhere.
        if (body.password) await destroyEmployeeSessions(rows[0].id);

        res.json(rows[0]);

      } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });

        if (
          error.code === '23505'
        ) {

          return res
            .status(409)
            .json({
              message:
                dupMessage(error)
            });
        }


        throw error;
      }
    }
  )
);


// =========================================================
// SOFT DELETE EMPLOYEE
// =========================================================

router.delete(
  '/:id',
  asyncHandler(
    async (req, res) => {

      await destroyEmployeeSessions(req.params.id);

      // A deactivated manager's team falls back to admin approval.
      await pool.query(
        'UPDATE employees SET manager_id = NULL WHERE manager_id = $1',
        [req.params.id]
      );

      const {
        rowCount
      } = await pool.query(

        `
        UPDATE employees

        SET is_active = false

        WHERE id = $1

          AND role IN ('employee', 'manager')
        `,

        [req.params.id]
      );


      if (!rowCount) {

        return res
          .status(404)
          .json({
            message:
              'Employee not found'
          });
      }


      res.json({
        message: 'Deleted'
      });
    }
  )
);


module.exports = router;
