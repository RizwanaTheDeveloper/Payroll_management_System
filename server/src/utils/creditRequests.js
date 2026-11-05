const pool = require('../config/db');
const asyncHandler = require('./asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { LOCK } = require('./loanRecovery');
const loanAmounts = require('./loanAmounts');
const { ESCALATE_AFTER_DAYS } = require('./workflowPolicy');

module.exports = function creditRequests(kind) {
  if (!['loan', 'salary_advance'].includes(kind)) throw new Error('Invalid credit type');
  const isAdvance = kind === 'salary_advance';
  const label = isAdvance ? 'Advance' : 'Loan';
  const router = require('express').Router();

  router.use(authenticate);

  const REGISTER = `SELECT a.*, a.first_recovery::text, a.disbursed_on::text,
    e.name, e.emp_code, COALESCE(r.recovered, 0) AS recovered,
    (SELECT name FROM employees WHERE id = a.manager_decided_by) AS manager_decided_by_name,
    CASE WHEN a.instalment_count IS NOT NULL THEN ROUND(a.amount * a.interest_percentage / 100, 2) END AS monthly_interest_amount,
    ROUND(a.amount * a.interest_percentage / 100, 2) * COALESCE(a.instalment_count, 1) AS interest_amount,
    a.amount + ROUND(a.amount * a.interest_percentage / 100, 2) * COALESCE(a.instalment_count, 1) AS total_repayable,
    a.amount + ROUND(a.amount * a.interest_percentage / 100, 2) * COALESCE(a.instalment_count, 1) - COALESCE(r.recovered, 0) AS outstanding,
    COALESCE((SELECT json_agg(json_build_object('month', p.month, 'year', p.year, 'amount', ar.amount))
      FROM advance_recoveries ar JOIN payslips p ON p.id = ar.payslip_id
      WHERE ar.advance_id = a.id), '[]'::json) AS period_recoveries,
    CASE WHEN a.status IN ('approved', 'active', 'paused') AND a.amount + ROUND(a.amount * a.interest_percentage / 100, 2) * COALESCE(a.instalment_count, 1) = COALESCE(r.recovered, 0)
      THEN 'completed' ELSE a.status END AS status
    FROM advances a JOIN employees e ON e.id = a.employee_id
    LEFT JOIN LATERAL (SELECT SUM(amount) AS recovered FROM advance_recoveries
      WHERE advance_id = a.id) r ON TRUE
    WHERE a.record_type = '${kind}'`;

  router.get('/', authorize('admin'), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`${REGISTER}
      ORDER BY (a.status = 'pending') DESC, a.created_at DESC, a.id DESC`);
    res.json(rows);
  }));

  // Manager: requests from direct reports, awaiting or carrying their recommendation.
  router.get('/team', authorize('manager'), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`${REGISTER}
      AND e.manager_id = $1 AND e.is_active
      ORDER BY (a.status = 'pending' AND a.manager_decision IS NULL) DESC, a.created_at DESC, a.id DESC`, [req.user.id]);
    res.json(rows);
  }));

  router.get('/my', authorize('employee', 'manager'), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`${REGISTER} AND a.employee_id = $1 ORDER BY a.created_at DESC, a.id DESC`, [req.user.id]);
    res.json(rows);
  }));

  if (isAdvance) {
    router.get('/employees', authorize('admin'), asyncHandler(async (req, res) => {
      const { rows } = await pool.query(`SELECT e.id AS employee_id, e.emp_code, e.name, e.is_active,
        COALESCE(e.advance, 0) AS legacy_advance,
        COALESCE(SUM(a.amount) FILTER (WHERE a.status = 'pending'), 0) AS pending_advance,
        COALESCE(SUM(a.amount - COALESCE(r.recovered, 0)) FILTER (WHERE a.status IN ('approved', 'active', 'paused')), 0) AS advance
        FROM employees e
        LEFT JOIN advances a ON a.employee_id = e.id AND a.record_type = 'salary_advance'
        LEFT JOIN LATERAL (SELECT SUM(amount) AS recovered FROM advance_recoveries WHERE advance_id = a.id) r ON TRUE
        WHERE e.role IN ('employee', 'manager')
        GROUP BY e.id ORDER BY e.emp_code, e.id`);
      res.json(rows);
    }));
  }

  router.get('/:id', authorize('admin', 'employee', 'manager'), asyncHandler(async (req, res) => {
    if (!/^\d+$/.test(req.params.id) || Number(req.params.id) > 2147483647) return res.status(400).json({ message: `Invalid ${label.toLowerCase()} ID.` });
    const { rows } = await pool.query(`${REGISTER} AND a.id = $1
      AND ($2::int IS NULL OR a.employee_id = $2)`, [req.params.id, req.user.role !== 'admin' ? req.user.id : null]);
    if (!rows.length) return res.status(404).json({ message: `${label} not found.` });
    const recoveries = await pool.query(`SELECT r.amount, p.id AS payslip_id, p.month, p.year
      FROM advance_recoveries r JOIN payslips p ON p.id = r.payslip_id
      WHERE r.advance_id = $1 ORDER BY p.year, p.month`, [req.params.id]);
    const events = await pool.query(`SELECT v.action, v.note, v.created_at, e.name AS actor
      FROM advance_events v LEFT JOIN employees e ON e.id = v.actor_id
      WHERE advance_id = $1 ORDER BY v.id DESC`, [req.params.id]);
    res.json({ ...rows[0], recoveries: recoveries.rows, events: events.rows });
  }));

  const money = (v) => /^(?:\d+)(?:\.\d{1,2})?$/.test(String(v)) && Number(v) > 0 && Number(v) < 1e10;
  const date = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

  router.post('/', authorize(...(isAdvance ? ['employee', 'manager', 'admin'] : ['employee', 'manager'])), asyncHandler(async (req, res) => {
    const body = req.body || {};
    const adminEnteredAdvance = isAdvance && req.user.role === 'admin';
    const employee_id = adminEnteredAdvance ? body.employee_id : req.user.id;
    const initialStatus = adminEnteredAdvance ? 'approved' : 'pending';
    const { amount, instalment: requestedInstalment, first_recovery, reason } = body;
    const reasonText = isAdvance && reason == null ? '' : reason;
    const instalment_count = isAdvance ? 1 : body.instalment_count;
    const interest_percentage = isAdvance ? 0 : (body.interest_percentage === undefined ? 0 : body.interest_percentage);
    const validInterest = /^(?:\d+)(?:\.\d{1,2})?$/.test(String(interest_percentage))
      && Number(interest_percentage) >= 0 && Number(interest_percentage) <= 100;
    // Older API requests retain their one-time terms; new requests specify a count.
    const hasCount = instalment_count !== undefined;
    const validCount = !hasCount || (/^\d+$/.test(String(instalment_count))
      && Number(instalment_count) >= 1 && Number(instalment_count) <= 360
      && Number(instalment_count) <= Math.round(Number(amount) * 100));
    const amounts = money(amount) && validInterest && validCount
      ? loanAmounts(amount, interest_percentage, hasCount ? instalment_count : null) : { total: 0, instalment: 0 };
    const totalRepayable = amounts.total;
    // Calculate payroll deduction on the server, rather than trusting a submitted amount.
    const instalment = hasCount ? amounts.instalment.toFixed(2) : requestedInstalment;
    if (!['number', 'string'].includes(typeof employee_id) || !/^\d+$/.test(String(employee_id))
      || !Number.isInteger(Number(employee_id)) || Number(employee_id) <= 0 || Number(employee_id) > 2147483647 || !money(amount)
      || !validInterest || !validCount || !money(instalment) || Number(instalment) > totalRepayable || Number(instalment) >= 1e10
      || !date(first_recovery) || !first_recovery.endsWith('-01')
      || typeof reasonText !== 'string' || (!isAdvance && !reasonText.trim()) || reasonText.length > 2000) {
      return res.status(400).json({ message: isAdvance
        ? 'Select an employee, a positive advance amount (up to 2 decimals) and a recovery month. The optional reason must be text up to 2000 characters.'
        : 'Provide a positive loan amount (up to 2 decimals), monthly interest from 0 to 100%, 1 to 360 instalments (at least one paise of principal per instalment), a first recovery month and a reason. Total repayment is principal plus monthly interest for all instalments.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (adminEnteredAdvance) await client.query(LOCK);
      const result = await client.query(`INSERT INTO advances
        (employee_id, amount, instalment, first_recovery, reason, created_by, interest_percentage, instalment_count, status, record_type)
        SELECT id, $2, $3, $4, $5, $6, $7, $8, $10, $9 FROM employees
        WHERE id = $1 AND role IN ('employee', 'manager') AND is_active RETURNING id, status`,
      [employee_id, amount, instalment, first_recovery, reasonText.trim(), req.user.id, interest_percentage, hasCount ? Number(instalment_count) : null, kind, initialStatus]);
      if (!result.rows.length) {
        await client.query('ROLLBACK');
        return res.status(403).json({ message: `Only active employees can receive a ${isAdvance ? 'salary advance' : 'loan'}.` });
      }
      await client.query(`INSERT INTO advance_events (advance_id, actor_id, action, note)
        VALUES ($1, $2, 'created', $3)`, [result.rows[0].id, req.user.id, reasonText.trim()]);
      if (adminEnteredAdvance) {
        await client.query(`INSERT INTO advance_events (advance_id, actor_id, action, note)
          VALUES ($1, $2, 'approve', 'Advance entered directly by administrator.')`, [result.rows[0].id, req.user.id]);
      }
      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  }));

  // Manager: first-level recommendation. The administrator still gives final approval.
  router.patch('/:id/recommendation', authorize('manager'), asyncHandler(async (req, res) => {
    const { decision, note = '' } = req.body || {};
    if (!/^\d+$/.test(req.params.id) || Number(req.params.id) > 2147483647
      || !['recommended', 'declined'].includes(decision) || typeof note !== 'string' || note.length > 2000) {
      return res.status(400).json({ message: 'Choose recommend or decline.' });
    }
    if (decision === 'declined' && !note.trim()) {
      return res.status(400).json({ message: 'Provide a reason for declining this request.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(LOCK);
      const { rows } = await client.query(
        `SELECT a.id, a.status FROM advances a JOIN employees e ON e.id = a.employee_id
         WHERE a.id = $1 AND a.record_type = $2 AND e.manager_id = $3 FOR UPDATE OF a`,
        [req.params.id, kind, req.user.id]);
      if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ message: `${label} not found.` }); }
      if (rows[0].status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: `This ${label.toLowerCase()} is already ${rows[0].status}.` });
      }
      await client.query(`UPDATE advances SET manager_decision = $2, manager_note = $3,
        manager_decided_by = $4, manager_decided_at = NOW() WHERE id = $1`,
      [rows[0].id, decision, note.trim() || null, req.user.id]);
      await client.query(`INSERT INTO advance_events (advance_id, actor_id, action, note) VALUES ($1, $2, $3, $4)`,
        [rows[0].id, req.user.id, decision === 'recommended' ? 'manager_recommend' : 'manager_decline', note.trim()]);
      await client.query('COMMIT');
      res.json({ message: 'Your recommendation was recorded.' });
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  }));

  router.patch('/:id/status', authorize('admin'), asyncHandler(async (req, res) => {
    const { action, note = '', disbursed_on, payment_reference } = req.body || {};
    const transitions = { approve: ['pending', 'approved'], reject: ['pending', 'rejected'],
      disburse: ['approved', 'active'], pause: ['active', 'paused'], resume: ['paused', 'active'] };
    if (!/^\d+$/.test(req.params.id) || Number(req.params.id) > 2147483647 || !Object.hasOwn(transitions, action)
      || typeof note !== 'string' || note.length > 2000) {
      return res.status(400).json({ message: `Invalid ${label.toLowerCase()} action.` });
    }
    if (['reject', 'pause', 'resume'].includes(action) && !note.trim()) {
      return res.status(400).json({ message: 'Provide a reason for this decision.' });
    }
    if (action === 'disburse' && (!date(disbursed_on)
      || disbursed_on > new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      || typeof payment_reference !== 'string' || !payment_reference.trim() || payment_reference.length > 150)) {
      return res.status(400).json({ message: 'Provide a payment date (today or earlier) and payment reference.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(LOCK);
      const { rows } = await client.query('SELECT * FROM advances WHERE id = $1 AND record_type = $2 FOR UPDATE', [req.params.id, kind]);
      const loan = rows[0];
      if (!loan) { await client.query('ROLLBACK'); return res.status(404).json({ message: `${label} not found.` }); }
      if (loan.status !== transitions[action][0]) {
        await client.query('ROLLBACK'); return res.status(409).json({ message: `Status changed. Refresh and review the ${label.toLowerCase()}.` });
      }
      if (action === 'approve') {
        // The manager recommends first. Once a request has waited past the escalation window the
        // administrator may decide it, so it is never stuck while a manager is away.
        const owner = await client.query(
          `SELECT e.manager_id, (CURRENT_DATE - a.created_at::date) >= $2 AS escalated
           FROM advances a JOIN employees e ON e.id = a.employee_id WHERE a.id = $1`,
          [loan.id, ESCALATE_AFTER_DAYS]);
        if (owner.rows[0]?.manager_id && !loan.manager_decision && !owner.rows[0].escalated) {
          await client.query('ROLLBACK');
          return res.status(409).json({ message: `Awaiting the manager's recommendation before this ${label.toLowerCase()} can be approved.` });
        }
      }
      const recovered = await client.query('SELECT COALESCE(SUM(amount),0) AS amount FROM advance_recoveries WHERE advance_id=$1', [loan.id]);
      if (Number(recovered.rows[0].amount) >= loanAmounts(loan.amount, loan.interest_percentage, loan.instalment_count).total) {
        await client.query('ROLLBACK'); return res.status(409).json({ message: `This ${label.toLowerCase()} has been fully recovered.` });
      }
      await client.query(`UPDATE advances SET status=$2,
        disbursed_on=COALESCE($3::date, disbursed_on), payment_reference=COALESCE($4, payment_reference)
        WHERE id=$1`, [loan.id, transitions[action][1], action === 'disburse' ? disbursed_on : null,
        action === 'disburse' ? payment_reference.trim() : null]);
      await client.query(`INSERT INTO advance_events (advance_id, actor_id, action, note) VALUES ($1,$2,$3,$4)`,
        [loan.id, req.user.id, action, action === 'disburse' ? `${disbursed_on} · ${payment_reference.trim()}${note ? ` · ${note}` : ''}` : note.trim()]);
      await client.query('COMMIT');
      res.json({ message: `${label} updated.` });
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  }));

  router.use((err, req, res, next) => {
    console.error(`${label} request failed:`, err.code || err.name);
    res.status(500).json({ message: `Unable to save or load ${isAdvance ? 'advances' : 'loans'}. Please try again.` });
  });
  return router;
};
