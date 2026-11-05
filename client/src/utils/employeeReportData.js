import { buildReports, reportCsv } from './reportData.js';

const number = (value) => Number(value) || 0;
const total = (rows, key) => Math.round(rows.reduce((sum, row) => sum + number(row[key]), 0) * 100) / 100;
const count = (key, label) => ({ key, label, type: 'number' });
const money = (key, label) => ({ key, label, type: 'money' });
const text = (key, label) => ({ key, label, type: 'text' });
const date = (key, label) => ({ key, label, type: 'date' });
const datetime = (key, label) => ({ key, label, type: 'datetime' });

export const employeeSummaryColumns = [text('emp_code', 'Employee ID'), text('name', 'Name'), text('department', 'Department'),
  count('present', 'Present days'), count('paid_leave', 'Paid leave days'), count('unpaid', 'Unpaid days'),
  count('leave_requests', 'Leave requests'), count('pending_leave_requests', 'Pending leave requests'), count('rejected_leave_requests', 'Rejected leave requests'),
  money('loan_balance', 'Loan balance'), money('advance_balance', 'Advance balance'), money('net_pay', 'Net pay'), text('payroll_status', 'Payslip status'), text('workflow_status', 'Approval status'), text('payment_status', 'Payment status')];

export function buildEmployeeSummaries(data, period) {
  const reports = buildReports(data || {}, { period });
  const rows = (id) => reports.find((report) => report.id === id)?.rows || [];
  const indexed = (id) => new Map(rows(id).map((row) => [String(row.employee_id ?? row.id), row]));
  const attendance = indexed('employee-attendance');
  const utilization = indexed('utilization');
  const balances = indexed('balance');
  const salary = indexed('salary');
  const deductions = indexed('deduction-summary');
  const coverage = indexed('payslip-register');
  const group = (items) => {
    const result = new Map();
    for (const row of items || []) {
      const key = String(row.employee_id);
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(row);
    }
    return result;
  };
  const leaves = group(data?.leaves);
  const credits = group(rows('loan-register'));
  return (data?.employees || []).map((employee) => {
    const id = String(employee.id);
    const marks = attendance.get(id);
    const used = balances.get(id);
    const days = utilization.get(id);
    const payroll = salary.get(id);
    const deduction = deductions.get(id);
    const requests = leaves.get(id) || [];
    const finance = credits.get(id) || [];
    const loanRequests = finance.filter((row) => row.record_type !== 'salary_advance');
    const advances = finance.filter((row) => row.record_type === 'salary_advance');
    const approved = (items) => items.filter((row) => ['approved', 'active', 'paused', 'completed'].includes(row.status));
    const approvedBalance = (items) => total(approved(items), 'outstanding');
    return { ...employee, employee_id: employee.id,
      present: marks?.present || 0, paid_leave: marks?.leave || 0, unpaid: marks?.unpaid || 0,
      attendance_records: marks?.records || 0, worked_hours: marks?.worked || 0,
      missing_punches: marks?.missing || 0, invalid_punches: marks?.invalid || 0,
      paid_allowance: used?.allowance ?? null, paid_balance: used?.balance ?? null,
      leave_requests: requests.length,
      approved_leave_requests: requests.filter((row) => row.status === 'approved').length,
      pending_leave_requests: requests.filter((row) => row.status === 'pending').length,
      rejected_leave_requests: requests.filter((row) => row.status === 'rejected').length,
      requested_days: days?.requested ?? total(requests, 'period_days'),
      approved_days: days?.approved ?? total(requests.filter((row) => row.status === 'approved'), 'period_days'),
      pending_days: days?.pending ?? total(requests.filter((row) => row.status === 'pending'), 'period_days'),
      rejected_days: days?.rejected ?? total(requests.filter((row) => row.status === 'rejected'), 'period_days'),
      payslip_count: payroll ? 1 : 0, payroll_status: coverage.get(id)?.status || 'Outside employment period',
      workflow_status: payroll?.status || 'Not generated', payment_status: payroll?.payment_status || 'Not recorded',
      paid_on: payroll?.paid_on ?? null, payment_reference: payroll?.payment_reference || '',
      employed_days: payroll?.employed_days ?? null, net_paid_days: payroll?.net_paid_days ?? null,
      unpaid_leave_deduction: payroll?.unpaid_leave_deduction ?? null, additional_deductions: payroll?.additional_deductions ?? null,
      basic: payroll?.basic ?? null, hra: payroll?.hra ?? null, special_allowance: payroll?.special_allowance ?? null,
      lta: payroll?.lta ?? null, other_allowances: payroll?.other_allowances ?? null, allowances: payroll?.allowances ?? null,
      gross: payroll?.gross ?? null, net_pay: payroll?.net ?? null,
      epf: deduction?.epf ?? null, professional_tax: deduction?.professional_tax ?? null,
      total_deductions: deduction?.total_deductions ?? null, other_deductions: deduction?.deductions ?? null,
      loan_deduction: deduction?.loan_recovery ?? null, advance_deduction: deduction?.salary_advance ?? null,
      loan_requests: loanRequests.length, advance_requests: advances.length,
      approved_loans: approved(loanRequests).length, approved_advances: approved(advances).length,
      completed_loans: approved(loanRequests).filter((row) => number(row.outstanding) === 0).length,
      completed_advances: approved(advances).filter((row) => number(row.outstanding) === 0).length,
      pending_loans: loanRequests.filter((row) => row.status === 'pending').length,
      rejected_loans: loanRequests.filter((row) => row.status === 'rejected').length,
      pending_advances: advances.filter((row) => row.status === 'pending').length,
      rejected_advances: advances.filter((row) => row.status === 'rejected').length,
      loan_balance: approvedBalance(loanRequests), advance_balance: approvedBalance(advances),
      loan_recovered: total(loanRequests, 'recovered'), advance_recovered: total(advances, 'recovered') };
  });
}

export function employeeDetailReports(data, period, employeeId) {
  const own = (rows) => (rows || []).filter((row) => String(row.employee_id) === String(employeeId));
  const credits = buildReports(data || {}, { period, employeeId: String(employeeId) }).find((report) => report.id === 'loan-register');
  const creditColumns = [text('reference', 'Request'), money('amount', 'Amount'), text('status', 'Current status'),
    date('first_recovery', 'Recovery starts'), money('total_repayable', 'Total repayment'), money('recovered', 'Recovered through month'), money('outstanding', 'Remaining balance')];
  const creditRows = (advance) => credits.rows.filter((row) => (row.record_type === 'salary_advance') === advance)
    .map((row) => ({ ...row, reference: `${advance ? 'ADV' : 'LOAN'}-${row.id}`,
      status: ['approved', 'active', 'paused'].includes(row.status) && number(row.outstanding) === 0 ? 'completed' : row.status }));
  return [
    { id: 'payroll-activity', title: 'Payroll review and payment history', columns: [text('action', 'Action'), text('actor', 'Changed by'), datetime('created_at', 'Date / time'), text('reason', 'Reason / reference')], rows: own(data?.payroll_audit), note: 'Changes to this payroll month, including corrections, reviews, finalization and recorded payments.' },
    { id: 'attendance', title: 'Daily attendance', columns: [date('work_date', 'Date'), text('status_label', 'Status'), text('day_type', 'Day type'),
      text('check_in', 'Check in'), text('check_out', 'Check out'), count('worked_hours', 'Worked hours'), text('note', 'Note')],
      rows: own(data?.attendance).map((row) => ({ ...row, status_label: { present: 'Present', absent: 'Unpaid leave', leave: 'Paid leave', paid_leave: 'Paid leave' }[row.status] || row.status })),
      note: 'Half-day presence counts as 0.5 day. Unmarked days are not counted as unpaid. Leave follows the monthly two-day paid allowance.' },
    { id: 'leaves', title: 'Leave requests', columns: [text('id', 'Request ID'), text('leave_type', 'Leave type'), date('start_date', 'From'), date('end_date', 'To'),
      count('period_days', 'Days in month'), text('status', 'Status'), text('reason', 'Reason'), text('rejection_reason', 'Rejection reason')], rows: own(data?.leaves),
      note: 'Requests overlapping this month. Day counts are clipped to the selected month; counts of requests and counts of days are shown separately.' },
    { id: 'loans', title: 'Loans', columns: creditColumns, rows: creditRows(false), note: 'Requests created through the selected month. Balances include recoveries through that month; approval statuses are current.' },
    { id: 'advances', title: 'Salary advances', columns: creditColumns, rows: creditRows(true), note: 'Salary advances have no interest. Pending and rejected requests are excluded from approved balances.' },
    { id: 'activity', title: 'Advance and loan activity', columns: [text('reference', 'Request'), text('action', 'Action'), text('actor', 'Changed by'), datetime('created_at', 'Date / time'), text('note', 'Note')],
      rows: own(data?.audit).map((row) => ({ ...row, reference: `${row.record_type === 'salary_advance' ? 'ADV' : 'LOAN'}-${row.advance_id}` })), note: 'Recorded decisions and changes in the selected month.' }
  ];
}

export function employeeReportCsv(summary, details, metadata) {
  const summaryColumns = [
    ...employeeSummaryColumns,
    date('paid_on', 'Payment date'), text('payment_reference', 'Payment reference'), count('employed_days', 'Employment days'), count('net_paid_days', 'Paid days'), money('unpaid_leave_deduction', 'Loss Of Pay deduction'), money('additional_deductions', 'Additional deductions'),
    ...[count('attendance_records', 'Attendance records'), count('worked_hours', 'Worked hours'), count('missing_punches', 'Missing punches'), count('invalid_punches', 'Invalid punch pairs'),
      count('approved_leave_requests', 'Approved leave requests'), count('requested_days', 'Requested leave days'), count('approved_days', 'Approved leave days'),
      count('pending_days', 'Pending leave days'), count('rejected_days', 'Rejected leave days'), count('paid_allowance', 'Monthly paid allowance'), count('paid_balance', 'Paid leave balance'),
      count('payslip_count', 'Payslips'), money('gross', 'Gross salary'), money('total_deductions', 'Total deductions'), money('basic', 'Basic salary'), money('hra', 'HRA'),
      money('special_allowance', 'Special allowance'), money('lta', 'LTA'), money('other_allowances', 'Other allowances'), money('allowances', 'Additional allowances'),
      money('epf', 'EPF'), money('professional_tax', 'Professional tax'), money('other_deductions', 'Other / Loss Of Pay deductions'), money('loan_deduction', 'Loan deduction'), money('advance_deduction', 'Advance deduction'),
      count('loan_requests', 'Loan requests through month'), count('advance_requests', 'Advance requests through month'), count('pending_loans', 'Pending loans'), count('rejected_loans', 'Rejected loans'),
      count('approved_loans', 'Approved loans including repaid'), count('completed_loans', 'Fully repaid loans'), count('approved_advances', 'Approved advances including repaid'), count('completed_advances', 'Fully repaid advances'),
      count('pending_advances', 'Pending advances'), count('rejected_advances', 'Rejected advances'), money('loan_recovered', 'Loans recovered through month'), money('advance_recovered', 'Advances recovered through month')]
  ];
  return [reportCsv({ title: 'Individual employee report', columns: summaryColumns, rows: [summary], note: 'Counts and salary relate to the selected month. Credit request counts and recoveries run through that month.' }, metadata),
    ...details.map((report) => reportCsv(report, metadata))].join('\r\n\r\n');
}
