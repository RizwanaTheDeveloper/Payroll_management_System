export const reportCategories = [
  ['payroll', 'Payroll'], ['attendance', 'Attendance'], ['leave', 'Leave'],
  ['deductions', 'Deductions & statutory'], ['employees', 'Employees'],
  ['payments', 'Payments'], ['payslips', 'Payslips'], ['loans', 'Advances / loans'],
  ['analytics', 'Payroll analytics'], ['audit', 'Audit'],
];
const num = (value) => Number(value) || 0;
const sum = (rows, key) => rows.reduce((total, row) => total + num(row[key]), 0);
const round = (value) => Math.round(value * 100) / 100;
const column = (key, label, type = 'text') => ({ key, label, type });
const identity = [column('emp_code', 'Employee ID'), column('name', 'Employee'), column('department', 'Department')];
const cash = (key, label) => column(key, label, 'money');
const count = (key, label) => column(key, label, 'number');
const date = (key, label) => column(key, label, 'date');
const salaryNote = 'Based on saved payslips and current employee departments. Gross includes all earnings; deductions include unpaid leave, where applied.';

export function buildReports(data, { period, department = '', employeeId = '' }) {
  const [year, month] = period.split('-').map(Number);
  const start = `${period}-01`;
  const end = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const priorDate = new Date(Date.UTC(year, month - 2, 1));
  const priorYear = priorDate.getUTCFullYear(), priorMonth = priorDate.getUTCMonth() + 1;
  const employees = (data.employees || []).filter((e) => (!department || e.department === department)
    && (!employeeId || String(e.id) === String(employeeId)));
  const employeeMap = new Map(employees.map((e) => [String(e.id), e]));
  const scoped = (rows) => (rows || []).filter((r) => employeeMap.has(String(r.employee_id)))
    .map((r) => ({ ...r, ...Object.fromEntries(identity.map(({ key }) =>
      [key, employeeMap.get(String(r.employee_id))[key]])) }));
  const slips = scoped(data.payslips);
  const payroll = slips.filter((p) => num(p.year) === year && num(p.month) === month).map((p) => {
    const allowances = ['hra', 'special_allowance', 'lta', 'other_allowances', 'allowances'].reduce((s, k) => s + num(p[k]), 0);
    const deductions = num(p.epf) + num(p.professional_tax) + num(p.advance) + num(p.deductions);
    return { ...p, basic: num(p.basic), total_allowances: allowances, gross: num(p.basic) + allowances,
      total_deductions: deductions, net: num(p.net_pay), payroll_status: p.status || 'Generated',
      salary_advance: Math.max(0, round(num(p.advance) - num(p.loan_recovery))) };
  });
  const attendance = scoped(data.attendance);
  const leaves = scoped(data.leaves);
  const loans = scoped(data.loans).map((l) => ({ ...l,
    credit_type: l.record_type === 'salary_advance' ? 'Salary advance' : 'Loan',
    outstanding: Math.max(0, round(num(l.total_repayable) - num(l.recovered))) }));
  const audit = scoped(data.audit).map((entry) => ({ ...entry,
    credit_type: entry.record_type === 'salary_advance' ? 'Salary advance' : 'Loan' }));
  // Joining/resignation dates describe the selected period; current active flag is shown separately.
  const eligible = employees.filter((e) => (!e.joining_date || e.joining_date < end)
    && (!e.resignation_date || e.resignation_date >= start));
  const joiners = employees.filter((e) => e.joining_date >= start && e.joining_date < end);
  const exits = employees.filter((e) => e.resignation_date >= start && e.resignation_date < end);
  const grouped = (rows, keys) => {
    const groups = new Map();
    for (const row of rows) {
      const key = row.department || 'Unassigned';
      const g = groups.get(key) || { department: key, employees: new Set(), ...Object.fromEntries(keys.map((k) => [k, 0])) };
      g.employees.add(row.employee_id ?? row.id);
      keys.forEach((k) => { g[k] += num(row[k]); });
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => ({ ...g, employees: g.employees.size }))
      .sort((a, b) => a.department.localeCompare(b.department));
  };
  const totals = { employees: payroll.length, gross: sum(payroll, 'gross'),
    total_deductions: sum(payroll, 'total_deductions'), net: sum(payroll, 'net') };
  const reports = [];
  const add = (category, id, title, columns, rows, note = '', summary) => {
    reports.push({ category, id, title, columns, rows, note, summary: summary || rows[0] || null });
  };
  const unavailable = (category, id, title, note) => {
    reports.push({ category, id, title, columns: [], rows: [], unavailable: true, note });
  };

  const payrollColumns = [...identity, cash('basic', 'Basic'), cash('total_allowances', 'Allowances'),
    cash('gross', 'Gross'), cash('total_deductions', 'Deductions'), cash('net', 'Net pay'), column('payroll_status', 'Payroll status')];
  add('payroll', 'register', 'Payroll register', payrollColumns, payroll, salaryNote);
  const summaryColumns = [count('employees', 'Employees'), cash('gross', 'Gross payroll'),
    cash('total_deductions', 'Deductions'), cash('net', 'Net payroll')];
  add('payroll', 'monthly-payroll', 'Monthly payroll summary', summaryColumns, [totals], `${salaryNote} Employer contributions are not recorded.`);
  const departmentPayroll = grouped(payroll, ['gross', 'total_deductions', 'net']);
  add('payroll', 'department-payroll', 'Department payroll', [column('department', 'Department'), ...summaryColumns], departmentPayroll, salaryNote);
  add('payroll', 'salary', 'Employee salary breakdown', [...identity, cash('basic', 'Basic'), cash('hra', 'HRA'),
    cash('special_allowance', 'Special allowance'), cash('lta', 'LTA'), cash('other_allowances', 'Other allowances'),
    cash('allowances', 'Additional allowances'), cash('gross', 'Gross'), cash('total_deductions', 'Deductions'), cash('net', 'Net pay')], payroll, salaryNote);
  const previous = new Map(slips.filter((p) => num(p.year) === priorYear && num(p.month) === priorMonth)
    .map((p) => [String(p.employee_id), p]));
  const variance = payroll.map((p) => {
    const old = previous.get(String(p.employee_id));
    const previousGross = old ? ['basic', 'hra', 'special_allowance', 'lta', 'other_allowances', 'allowances'].reduce((s, k) => s + num(old[k]), 0) : null;
    const difference = previousGross == null ? null : round(p.gross - previousGross);
    return { ...p, previous: previousGross, difference,
      change: previousGross ? round(difference / previousGross * 100) : null,
      reason: old ? 'Reason not recorded' : 'No previous month payslip' };
  });
  add('payroll', 'variance', 'Payroll variance', [...identity, cash('previous', 'Previous gross'), cash('gross', 'Current gross'),
    cash('difference', 'Difference'), column('change', 'Change %', 'percent'), column('reason', 'Reason')], variance,
  'Compares saved gross earnings with the previous calendar month. A missing or zero previous salary has no percentage comparison.');

  const attendanceEmployees = employees.map((e) => {
    const records = attendance.filter((r) => String(r.employee_id) === String(e.id));
    return { ...e, employee_id: e.id, present: records.filter((r) => r.status === 'present').reduce((s, r) => s + (r.day_type === 'half' ? 0.5 : 1), 0),
      unpaid: records.filter((r) => r.status === 'absent').length,
      leave: records.filter((r) => ['leave', 'paid_leave'].includes(r.status)).length,
      worked: round(sum(records, 'worked_hours')),
      missing: records.filter((r) => Boolean(r.check_in) !== Boolean(r.check_out)).length,
      invalid: records.filter((r) => r.check_in && r.check_out && r.worked_hours == null).length,
      records: records.length };
  }).filter((e) => e.records);
  const attendanceColumns = [count('present', 'Present days'), count('unpaid', 'Unpaid leave days'),
    count('leave', 'Paid leave days'), count('worked', 'Worked hours'), count('missing', 'Missing punches')];
  const attendanceNote = 'Half-day presence counts as 0.5 day. Leave after the first two days per employee per month is unpaid. Hours use recorded punches; invalid punch pairs are excluded. Unmarked days are not treated as unpaid.';
  add('attendance', 'attendance-summary', 'Monthly attendance summary', attendanceColumns,
    [Object.fromEntries(['present', 'unpaid', 'leave', 'worked', 'missing'].map((k) => [k, round(sum(attendanceEmployees, k))]))], attendanceNote);
  add('attendance', 'employee-attendance', 'Employee attendance', [...identity, ...attendanceColumns], attendanceEmployees, attendanceNote);
  add('attendance', 'department-attendance', 'Department attendance', [column('department', 'Department'), count('employees', 'Employees'), ...attendanceColumns],
    grouped(attendanceEmployees, ['present', 'unpaid', 'leave', 'worked', 'missing']), attendanceNote);
  const attendanceDetails = [...identity, date('work_date', 'Work date'), column('status_label', 'Status'),
    column('day_type', 'Day type'), column('check_in', 'Check in'), column('check_out', 'Check out'), count('worked_hours', 'Worked hours'), column('note', 'Note')];
  const detailAttendance = attendance.map((r) => ({ ...r, status_label: { present: 'Present', absent: 'Unpaid Leave', leave: 'Paid Leave', paid_leave: 'Paid Leave' }[r.status] || 'Unmarked' }));
  add('attendance', 'present-unpaid', 'Present / unpaid leave', attendanceDetails, detailAttendance.filter((r) => ['present', 'absent'].includes(r.status)), attendanceNote);
  add('attendance', 'worked-hours', 'Employee worked hours', [...identity, count('worked', 'Worked hours'), count('invalid', 'Invalid punch pairs')], attendanceEmployees,
    'Actual hours between valid check-in and check-out punches. Scheduled hours and overtime require employee shift schedules.');
  add('attendance', 'missing-punch', 'Missing punch report', attendanceDetails,
    detailAttendance.filter((r) => Boolean(r.check_in) !== Boolean(r.check_out)), 'Lists recorded days with a check-in or check-out missing. Unmarked days do not imply a missing punch.');
  for (const [id, title] of [['late', 'Late-coming report'], ['early', 'Early checkout report'], ['overtime', 'Overtime report']]) {
    unavailable('attendance', id, title, 'Employee shift schedules and attendance thresholds are not recorded yet.');
  }
  unavailable('attendance', 'corrections', 'Attendance correction report', 'Correction requests, previous marks, and approval history are not recorded yet.');

  const leaveEmployees = eligible.map((e) => {
    const requests = leaves.filter((l) => String(l.employee_id) === String(e.id));
    const a = attendanceEmployees.find((r) => String(r.id) === String(e.id));
    return { ...e, employee_id: e.id, allowance: 2, used: a?.leave || 0, unpaid: a?.unpaid || 0,
      balance: Math.max(0, 2 - (a?.leave || 0)), requested: sum(requests, 'period_days'),
      approved: sum(requests.filter((l) => l.status === 'approved'), 'period_days'),
      rejected: sum(requests.filter((l) => l.status === 'rejected'), 'period_days'),
      pending: sum(requests.filter((l) => l.status === 'pending'), 'period_days') };
  });
  const utilizationColumns = [count('requested', 'Requested days'), count('approved', 'Approved days'),
    count('rejected', 'Rejected days'), count('pending', 'Pending days')];
  const leaveNote = 'Request days are inclusive calendar days clipped to the selected month. Approved request days can include unpaid days. Actual paid usage follows effective attendance.';
  add('leave', 'utilization', 'Leave utilization', [...identity, ...utilizationColumns], leaveEmployees, leaveNote);
  add('leave', 'balance', 'Employee leave balance', [...identity, count('allowance', 'Monthly allowance'), count('used', 'Paid days used'),
    count('unpaid', 'Unpaid days'), count('pending', 'Pending request days'), count('balance', 'Paid balance')], leaveEmployees,
  'Two paid days per month; no carry-forward. Annual leave entitlements are not recorded. Unpaid days include explicit unpaid attendance.');
  add('leave', 'department-leave', 'Department leave usage', [column('department', 'Department'), count('employees', 'Employees'), ...utilizationColumns],
    grouped(leaveEmployees, ['requested', 'approved', 'rejected', 'pending']), leaveNote);
  const leaveTypes = [...new Set(leaves.map((l) => l.leave_type))].sort().map((type) => {
    const requests = leaves.filter((l) => l.leave_type === type);
    return { type, requested: sum(requests, 'period_days'),
      approved: sum(requests.filter((l) => l.status === 'approved'), 'period_days'),
      rejected: sum(requests.filter((l) => l.status === 'rejected'), 'period_days'),
      pending: sum(requests.filter((l) => l.status === 'pending'), 'period_days') };
  });
  add('leave', 'type-leave', 'Leave by type', [column('type', 'Leave type'), ...utilizationColumns], leaveTypes, leaveNote);
  for (const status of ['approved', 'rejected', 'pending']) {
    add('leave', `${status}-leave`, `${status[0].toUpperCase() + status.slice(1)} leave`, [...identity,
      column('leave_type', 'Leave type'), date('start_date', 'Start date'), date('end_date', 'End date'),
      count('period_days', 'Days this month'), column('reason', 'Reason')], leaves.filter((l) => l.status === status), leaveNote);
  }
  unavailable('leave', 'encashment', 'Leave encashment', 'Encashable entitlements, encashment requests, and payment amounts are not recorded yet.');

  add('deductions', 'deduction-summary', 'Employee deduction summary', [...identity, cash('epf', 'PF'),
    cash('professional_tax', 'Professional tax'), cash('loan_recovery', 'Loan recovery'), cash('salary_advance', 'Salary advance'),
    cash('unpaid_leave_deduction', 'Loss Of Pay'), cash('additional_deductions', 'Additional deductions'), cash('deductions', 'Other / Loss Of Pay total'), cash('total_deductions', 'Total deductions')], payroll, salaryNote);
  for (const [id, title, key, label] of [
    ['pf', 'PF deduction report', 'epf', 'Employee PF'], ['pt', 'Professional Tax report', 'professional_tax', 'Professional tax'],
    ['loan-deductions', 'Loan deduction report', 'loan_recovery', 'Loan recovery'],
    ['advance-deductions', 'Salary advance deductions', 'salary_advance', 'Salary advance'],
    ['other-deductions', 'Other deduction report', 'deductions', 'Other / Loss Of Pay'],
  ]) {
    add('deductions', id, title, [...identity, cash(key, label)], payroll.filter((p) => num(p[key]) !== 0),
      `${salaryNote}${id === 'pf' ? ' Employer PF contributions are not recorded.' : ''}`);
  }
  unavailable('deductions', 'esi', 'ESI deduction report', 'ESI amounts and employer contributions are not recorded separately.');
  unavailable('deductions', 'tds', 'TDS report', 'TDS amounts and taxable payroll values are not recorded separately.');

  const employeeColumns = [...identity, column('designation', 'Designation'), date('joining_date', 'Joining date'),
    date('resignation_date', 'Exit date'), column('active_label', 'Current status')];
  const employeeRows = (rows) => rows.map((e) => ({ ...e, active_label: e.is_active ? 'Active' : 'Inactive' }));
  add('employees', 'employee-summary', 'Monthly employee summary', [count('total', 'Employees in period'),
    count('active', 'Currently active'), count('joiners', 'New joiners'), count('exits', 'Exits')],
  [{ total: eligible.length, active: eligible.filter((e) => e.is_active).length, joiners: joiners.length, exits: exits.length }],
  'Period membership uses recorded joining and exit dates. Active status reflects the current employee record.');
  add('employees', 'employee-register', 'Employee register', employeeColumns, employeeRows(eligible));
  const designationGroups = new Map();
  eligible.forEach((e) => {
    const key = `${e.department}\u0000${e.designation || 'Unassigned'}`;
    const group = designationGroups.get(key) || { department: e.department, designation: e.designation || 'Unassigned', employees: 0 };
    group.employees++; designationGroups.set(key, group);
  });
  add('employees', 'department-staff', 'Department staffing', [column('department', 'Department'), column('designation', 'Designation'), count('employees', 'Employees')], [...designationGroups.values()]);
  add('employees', 'joiners', 'New joiners', employeeColumns, employeeRows(joiners));
  add('employees', 'exits', 'Employee exits', employeeColumns, employeeRows(exits));
  unavailable('employees', 'onboarding', 'Onboarding status', 'Onboarding completion and document checklists are not recorded yet.');

  const paidPayroll = payroll.filter((row) => row.payment_status === 'paid');
  add('payments', 'payment-summary', 'Payroll payment summary', [count('paid_count', 'Paid employees'), cash('paid_amount', 'Paid amount'), count('unpaid_count', 'Unpaid / unrecorded'), cash('unpaid_amount', 'Unpaid / unrecorded amount')],
    [{ paid_count: paidPayroll.length, paid_amount: sum(paidPayroll, 'net'), unpaid_count: payroll.length - paidPayroll.length, unpaid_amount: sum(payroll.filter((row) => row.payment_status !== 'paid'), 'net') }], 'Payment status comes from administrator-recorded transactions. Generated payslips alone do not confirm payment.');
  unavailable('payments', 'payment-batches', 'Payment batch report', 'Payment batches and transaction success or failure are not recorded yet.');
  add('payments', 'employee-payment', 'Employee payment report', [...identity, cash('net', 'Net pay'), column('payment_status', 'Payment status'), date('paid_on', 'Paid on'), column('payment_reference', 'Transaction reference')], payroll, 'Recorded salary payments for the selected payroll month. This report does not initiate bank transfers.');

  const byEmployee = new Map(payroll.map((p) => [String(p.employee_id), p]));
  const coverage = eligible.map((e) => {
    const slip = byEmployee.get(String(e.id));
    return { ...e, status: slip ? 'Generated' : 'Not generated', generated_at: slip?.generated_at || null, net: slip?.net ?? null };
  });
  add('payslips', 'payslip-summary', 'Monthly payslip summary', [count('employees', 'Employees in period'), count('generated', 'Generated'), count('pending', 'Not generated')],
    [{ employees: eligible.length, generated: coverage.filter((e) => e.status === 'Generated').length,
      pending: coverage.filter((e) => e.status !== 'Generated').length }], 'Coverage includes employees in the period, including currently inactive employees.');
  add('payslips', 'payslip-register', 'Employee payslip status', [...identity, column('status', 'Payslip status'), date('generated_at', 'Generated on'), cash('net', 'Net pay')], coverage);
  unavailable('payslips', 'publication', 'Publication / download report', 'Payslip publication and download events are not recorded yet.');

  add('loans', 'loan-register', 'Employee advances / loans', [...identity, column('id', 'Request ID'), column('credit_type', 'Type'), cash('amount', 'Principal'),
    cash('total_repayable', 'Total with interest'), cash('recovered', 'Recovered through period'), cash('outstanding', 'Outstanding'),
    cash('instalment', 'Monthly recovery'), column('status', 'Current status')], loans,
    'Repayments are counted through the selected payroll month. Terms and approval status are current. Outstanding includes interest; pending and rejected requests are listed but excluded from portfolio totals.');
  const portfolio = loans.filter((l) => !['pending', 'rejected'].includes(l.status));
  add('loans', 'loan-summary', 'Monthly advances / loans', [cash('issued', 'Principal issued'), cash('recovered', 'Recovered this month'), cash('outstanding', 'Outstanding with interest')],
    [{ issued: sum(portfolio.filter((l) => l.disbursed_on >= start && l.disbursed_on < end), 'amount'),
      recovered: sum(portfolio, 'period_recovered'), outstanding: sum(portfolio, 'outstanding') }],
  'Issued principal uses recorded disbursement dates. Recovery uses saved payslips. Portfolio outstanding includes approved salary advances and loans with their interest.');

  add('analytics', 'payroll-analytics', 'Monthly payroll analytics', [...summaryColumns, cash('average', 'Average gross salary')],
    [{ ...totals, average: payroll.length ? round(totals.gross / payroll.length) : 0 }], salaryNote);
  const opening = employees.filter((e) => (!e.joining_date || e.joining_date < start)
    && (!e.resignation_date || e.resignation_date >= start)).length;
  add('analytics', 'headcount', 'Headcount movement', [count('opening', 'Opening'), count('joiners', 'New joiners'), count('exits', 'Exits'), count('closing', 'Closing')],
    [{ opening, joiners: joiners.length, exits: exits.length, closing: opening + joiners.length - exits.length }],
    'Uses recorded employment dates; an exit date is the last employed day. Employees without a joining date are included in opening headcount.');
  add('analytics', 'department-cost', 'Department salary cost', [column('department', 'Department'), count('employees', 'Employees'), cash('gross', 'Gross payroll'), cash('average', 'Average gross salary')],
    departmentPayroll.map((g) => ({ ...g, average: g.employees ? round(g.gross / g.employees) : 0 })), 'Saved gross earnings only. Employer contributions are not recorded.');
  add('audit', 'loan-audit', 'Advance / loan audit trail', [...identity, column('advance_id', 'Request ID'), column('credit_type', 'Type'), column('action', 'Action'),
    column('actor', 'Changed by'), column('created_at', 'Date / time', 'datetime'), column('note', 'Note')], audit, 'Recorded advance and loan actions in the selected month.');
  unavailable('audit', 'salary-audit', 'Salary change audit', 'Salary change actors, previous values, and timestamps are not recorded. Payroll variance is available under Payroll.');
  unavailable('audit', 'attendance-audit', 'Attendance correction audit', 'Attendance correction request and approval history are not recorded yet.');
  unavailable('audit', 'payroll-audit', 'Payroll approval / version report', 'Payroll preparation, finance approvals, and version history are not recorded yet.');
  return reports;
}

export function formatReportValue(value, type = 'text') {
  if (value == null || value === '') return '—';
  if (type === 'money') return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(num(value));
  if (type === 'number') return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(num(value));
  if (type === 'percent') return `${num(value)}%`;
  if (type === 'datetime') {
    let timestamp = String(value).trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
    if (/[+-]\d{2}$/.test(timestamp)) timestamp += ':00';
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)) timestamp += '+05:30';
    const instant = new Date(timestamp);
    if (Number.isNaN(instant.getTime())) return '—';
    return instant.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
      .replace(/\b(am|pm)\b/gi, (part) => part.toUpperCase());
  }
  if (type === 'date') {
    // Preserve date-only values rather than shifting them across timezones.
    const part = String(value).slice(0, 10);
    const [y, m, d] = part.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  // Plain words from the database (casual, pending, full, paid_leave) read as labels.
  if (type === 'text' && /^[a-z]+(_[a-z]+)*$/.test(String(value))) {
    const words = String(value).replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return String(value);
}

export function reportPreview(report) {
  if (report.unavailable) return report.note;
  if (!report.summary || !report.rows.length) return 'No records for this selection.';
  const row = report.summary;
  return report.columns.filter((c) => c.key !== 'emp_code' && (c.key !== 'department' || !row.name)).slice(0, 6)
    .map((c) => ['name', 'department'].includes(c.key) ? row[c.key] : `${c.label}: ${formatReportValue(row[c.key], c.type)}`).join(' → ');
}

export function reportCsv(report, metadata) {
  const cell = (value) => {
    const text = String(value ?? '');
    return `"${(/^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
  };
  return [['Report', report.title], ...Object.entries(metadata), ['Notes', report.note], [],
    report.columns.map((c) => c.label), ...report.rows.map((r) => report.columns.map((c) => c.type === 'datetime' ? formatReportValue(r[c.key], c.type) : r[c.key] ?? ''))]
    .map((row) => row.map(cell).join(',')).join('\r\n');
}
