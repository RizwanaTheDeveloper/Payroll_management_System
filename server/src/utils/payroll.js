const { calcPayDays } = require('./payDays');
const { FIELDS, baseline } = require('./salaryHistory');
const { fail, amount, period } = require('./payrollValidation');
const EARNINGS = ['basic', 'hra', 'special_allowance', 'lta', 'other_allowances'];
const cents = (value) => Math.round(Number(value || 0) * 100);
const cash = (value) => Math.round(value) / 100;

function inputs(body) {
  const parsed = period(body);
  const mode = body.mode || 'generate';
  if (!['generate', 'update'].includes(mode)) fail('Invalid action mode.');
  return { ...parsed, mode, allowances: amount(body.allowances, 'Additional allowance'),
    deductions: amount(body.deductions, 'Additional deduction'),
    epf: amount(body.epf, 'EPF', null), professional_tax: amount(body.professional_tax, 'Professional tax', null) };
}

async function eligibleEmployees(client, input) {
  const { rows } = await client.query(`SELECT e.*, e.joining_date::text, e.resignation_date::text
    FROM employees e WHERE role IN ('employee', 'manager') AND (is_active OR resignation_date IS NOT NULL)
      AND ($1::int IS NULL OR id = $1)
      AND ($4::int IS NULL OR manager_id = $4)
      AND (joining_date IS NULL OR joining_date < make_date($3, $2, 1) + interval '1 month')
      AND (resignation_date IS NULL OR resignation_date >= make_date($3, $2, 1)) ORDER BY id`,
  [input.employeeId, input.month, input.year, input.teamManagerId ?? null]);
  return rows;
}

async function calculate(client, employee, input) {
  const start = `${input.year}-${String(input.month).padStart(2, '0')}-01`;
  const days = await calcPayDays(employee.id, input.month, input.year, client);
  const { rows: history } = await client.query(`SELECT h.*, h.effective_from::text FROM salary_history h
    WHERE employee_id = $1 AND effective_from < $2::date + interval '1 month' ORDER BY h.effective_from`, [employee.id, start]);
  const structures = history.length ? history : [{ ...employee, effective_from: '2000-01-01', id: null }];
  const earned = Object.fromEntries(EARNINGS.map((key) => [key, 0]));
  const unpaid = new Set(days.unpaidDates);
  const lateDates = (await client.query(`SELECT work_date::text AS work_date FROM attendance
    WHERE employee_id = $1 AND work_date >= $2::date AND work_date < $2::date + interval '1 month'
      AND status = 'present' AND check_in::time > TIME '09:10:00'
      AND ($3::date IS NULL OR work_date >= $3::date)
      AND ($4::date IS NULL OR work_date <= $4::date)
    ORDER BY work_date`, [employee.id, start, employee.joining_date, employee.resignation_date])).rows
    .map((row) => row.work_date).filter((workDate) => !unpaid.has(workDate));
  const penaltyDate = lateDates.length >= 3 ? lateDates[2] : null;
  let lateCents = 0;
  let leaveCents = 0, missingSalary = false;
  const versions = new Set();
  let current = structures[0];
  for (let day = 1; day <= days.monthDays; day++) {
    const workDate = `${start.slice(0, 8)}${String(day).padStart(2, '0')}`;
    if (employee.joining_date && workDate < employee.joining_date) continue;
    if (employee.resignation_date && workDate > employee.resignation_date) continue;
    current = structures.filter((row) => row.effective_from <= workDate).at(-1);
    if (!current || Number(current.basic) <= 0) { missingSalary = true; continue; }
    versions.add(current.id);
    for (const key of EARNINGS) {
      earned[key] += cents(current[key]);
      if (unpaid.has(workDate)) leaveCents += cents(current[key]);
      if (workDate === penaltyDate) lateCents += cents(current[key]) / 2;
    }
  }
  const result = Object.fromEntries(EARNINGS.map((key) => [key, cash(earned[key] / days.monthDays)]));
  const recoveries = (await client.query(`SELECT plan.advance_id, plan.amount, a.record_type
    FROM payroll_loan_plan plan JOIN advances a ON a.id = plan.advance_id
    WHERE plan.employee_id = $1 ORDER BY plan.advance_id`, [employee.id])).rows;
  const legacyAdvance = employee.joining_date?.slice(0, 7) === start.slice(0, 7) ? Number(employee.advance || 0) : 0;
  result.allowances = input.allowances;
  result.advance = cash(cents(legacyAdvance) + recoveries.reduce((sum, row) => sum + cents(row.amount), 0));
  result.unpaid_leave_deduction = cash(leaveCents / days.monthDays);
  result.additional_deductions = input.deductions;
  result.late_login_deduction = cash(lateCents / days.monthDays);
  result.late_login_count = lateDates.length;
  result.late_login_reason = penaltyDate
    ? `Late login after 9:10 AM IST on ${lateDates.length} days this month; half-day salary deducted (3-day threshold).`
    : '';
  result.deductions = cash(cents(result.unpaid_leave_deduction) + cents(input.deductions) + cents(result.late_login_deduction));
  result.gross = cash([...EARNINGS, 'allowances'].reduce((sum, key) => sum + cents(result[key]), 0));
  result.epf = input.epf ?? cash(cents(current.epf));
  result.professional_tax = input.professional_tax ?? cash(cents(current.professional_tax));
  result.total_deductions = cash(['epf', 'professional_tax', 'advance', 'deductions'].reduce((sum, key) => sum + cents(result[key]), 0));
  result.net_pay = cash(cents(result.gross) - cents(result.total_deductions));
  result.month_days = days.monthDays;
  result.employed_days = days.employedDays;
  result.unpaid_leave_days = days.unpaidLeaveDays;
  result.net_paid_days = Math.max(0, days.netPaidDays - (penaltyDate ? 0.5 : 0));
  result.calculation_snapshot = { basis: 'calendar_days', salary_versions: [...versions],
    structures: structures.filter((row) => versions.has(row.id)).map((row) => ({ id: row.id, effective_from: row.effective_from, ...Object.fromEntries(FIELDS.map((key) => [key, row[key]])) })),
    unpaid_dates: days.unpaidDates, late_login_dates: lateDates, late_login_penalty_date: penaltyDate,
    legacy_advance: legacyAdvance, recoveries,
    overrides: { epf: input.epf, professional_tax: input.professional_tax } };
  result.warnings = [];
  if (missingSalary) result.warnings.push('A salary structure with positive basic pay is missing for part of this employment period.');
  if (result.net_pay < 0) result.warnings.push('Deductions exceed earnings.');
  else if (result.gross && result.total_deductions > result.gross / 2) result.warnings.push('Deductions exceed 50% of gross earnings. Review before finalizing.');
  return { ...result, missingSalary };
}

async function event(client, before, after, actorId, action, reason = '') {
  const slip = after || before;
  await client.query(`INSERT INTO payroll_events (payslip_id, employee_id, month, year, actor_id, action, reason, before_snapshot, after_snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [after?.id || before?.id, slip.employee_id, slip.month, slip.year, actorId, action, reason,
    before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
}

async function generate(client, input, actorId) {
  const employees = await eligibleEmployees(client, input);
  if (input.employeeId && !employees.length) fail('Employee is not eligible in this month.', 400);
  let generated = 0, skippedNoSalary = 0, skippedLocked = 0;
  const warnings = [];
  const payslipIds = [];
  for (const employee of employees) {
    const before = (await client.query('SELECT * FROM payslips WHERE employee_id = $1 AND month = $2 AND year = $3 FOR UPDATE',
      [employee.id, input.month, input.year])).rows[0];
    if (before && input.mode !== 'update') continue;
    if (before?.status === 'finalized' || before?.payment_status === 'paid') {
      if (input.employeeId) fail('This payslip is locked. Reopen it with a correction reason before changing it.', 409);
      skippedLocked++; continue;
    }
    await baseline(client, employee, actorId);
    // Bulk update keeps each employee's own saved additional allowance / deduction.
    const bulkUpdate = input.mode === 'update' && !input.employeeId && before;
    const values = await calculate(client, employee, bulkUpdate
      ? { ...input, allowances: Number(before.allowances || 0), deductions: Number(before.additional_deductions || 0) }
      : input);
    if (values.missingSalary) {
      if (input.employeeId) fail(values.warnings[0]);
      skippedNoSalary++; continue;
    }
    if (values.net_pay < 0 && bulkUpdate) { skippedNoSalary++; warnings.push({ employee_id: employee.id, name: employee.name, message: 'Deductions exceed gross earnings; payslip left unchanged.' }); continue; }
    if (values.net_pay < 0) fail(`${employee.name}: deductions exceed gross earnings. Reduce deductions before generating payroll.`);
    const columns = [...EARNINGS, 'allowances', 'epf', 'professional_tax', 'advance', 'deductions',
      'net_pay', 'unpaid_leave_deduction', 'additional_deductions', 'late_login_deduction', 'late_login_count', 'late_login_reason', 'month_days', 'employed_days', 'net_paid_days', 'calculation_snapshot'];
    const parameters = [employee.id, input.month, input.year, ...columns.map((key) => key === 'calculation_snapshot' ? JSON.stringify(values[key]) : values[key])];
    const after = (await client.query(`INSERT INTO payslips (employee_id, month, year, ${columns.join(',')})
      VALUES (${parameters.map((_, i) => `$${i + 1}`).join(',')})
      ON CONFLICT (employee_id, month, year) DO UPDATE SET ${columns.map((key) => `${key} = EXCLUDED.${key}`).join(',')},
        status = 'draft', reviewed_by = NULL, reviewed_at = NULL,
        submitted_by = NULL, submitted_at = NULL, updated_at = NOW()
      RETURNING *`, parameters)).rows[0];
    await event(client, before, after, actorId, before ? 'updated' : 'generated');
    generated++;
    payslipIds.push(after.id);
    warnings.push(...values.warnings.map((message) => ({ employee_id: employee.id, name: employee.name, message })));
  }
  return { generated, skippedNoSalary, skippedLocked, warnings, payslipIds,
    message: generated ? `${generated} ${generated === 1 ? 'payslip' : 'payslips'} saved as draft.` : 'No new payslips were generated. Existing payslips were left unchanged.' };
}

module.exports = { inputs, eligibleEmployees, calculate, generate, event };
