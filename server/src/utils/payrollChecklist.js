const { eligibleEmployees, calculate } = require('./payroll');

async function checklist(client, input) {
  const start = `${input.year}-${String(input.month).padStart(2, '0')}-01`;
  const employees = await eligibleEmployees(client, input);
  const result = [];
  for (const employee of employees) {
    const { rows } = await client.query(`SELECT
      (SELECT COUNT(*)::int FROM generate_series(
        GREATEST($2::date, COALESCE($3::date, $2::date)),
        LEAST(($2::date + interval '1 month' - interval '1 day')::date,
          COALESCE($4::date, ($2::date + interval '1 month' - interval '1 day')::date),
          (NOW() AT TIME ZONE 'Asia/Kolkata')::date - 1), interval '1 day') d
        WHERE EXTRACT(ISODOW FROM d) < 6 AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = $1 AND a.work_date = d::date)
          AND NOT EXISTS (SELECT 1 FROM leaves l WHERE l.employee_id = $1 AND l.status = 'approved' AND d::date BETWEEN l.start_date AND l.end_date)) AS missing_attendance,
      (SELECT COUNT(*)::int FROM attendance WHERE employee_id = $1 AND status = 'present'
        AND work_date >= $2::date AND work_date < $2::date + interval '1 month'
        AND (check_in IS NULL OR check_out IS NULL OR check_out < check_in)) AS missing_punches,
      (SELECT COUNT(*)::int FROM leaves WHERE employee_id = $1 AND status = 'pending'
        AND start_date < $2::date + interval '1 month' AND end_date >= $2::date) AS pending_leaves,
      (SELECT basic FROM salary_history WHERE employee_id = $1 AND effective_from < $2::date + interval '1 month'
        ORDER BY effective_from DESC LIMIT 1) AS history_basic`,
    [employee.id, start, employee.joining_date, employee.resignation_date]);
    const slip = (await client.query('SELECT id, status, payment_status, net_pay, published_at FROM payslips WHERE employee_id = $1 AND month = $2 AND year = $3', [employee.id, input.month, input.year])).rows[0];
    const preview = await calculate(client, employee, input);
    result.push({ employee_id: employee.id, name: employee.name, emp_code: employee.emp_code,
      ...rows[0], missing_salary: preview.missingSalary,
      payslip_id: slip?.id || null, payroll_status: slip?.status || 'not_generated', payment_status: slip?.payment_status || 'unpaid',
      published: Boolean(slip?.published_at) });
  }
  return { period: start.slice(0, 7), employees: result, summary: {
    eligible: result.length, missing_attendance: result.reduce((n, r) => n + r.missing_attendance, 0),
    missing_punches: result.reduce((n, r) => n + r.missing_punches, 0),
    pending_leaves: result.reduce((n, r) => n + r.pending_leaves, 0),
    missing_salary: result.filter((r) => r.missing_salary).length,
    not_generated: result.filter((r) => !r.payslip_id).length,
    submitted: result.filter((r) => r.payroll_status === 'submitted').length,
    finalized: result.filter((r) => r.payroll_status === 'finalized').length,
    published: result.filter((r) => r.published).length,
    paid: result.filter((r) => r.payment_status === 'paid').length,
  }, note: 'Attendance gaps cover elapsed Monday–Friday dates within employment. Approved leave is excluded. Check company holidays and working schedules before making deductions. Gaps are advisory and do not automatically reduce salary.' };
}

module.exports = checklist;
