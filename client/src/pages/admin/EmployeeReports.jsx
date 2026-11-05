import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { FiArrowLeft, FiDownload, FiPrinter, FiRefreshCw } from 'react-icons/fi';
import api from '../../api';
import { formatReportValue as format, reportCsv } from '../../utils/reportData';
import { buildEmployeeSummaries, employeeDetailReports, employeeReportCsv, employeeSummaryColumns } from '../../utils/employeeReportData';
import './EmployeeReports.css';
import { useAuth } from '../../context/AuthContext';

const currentPeriod = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
const validPeriod = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '') && Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2100;
const PAGE_SIZE = 25;

function Metrics({ title, row, fields, note }) {
  return <section className="employee-report-section"><h2>{title}</h2>
    <dl className="employee-report-metrics">{fields.map(([key, label, type = 'number']) => <div key={key}><dt>{label}</dt><dd>{format(row[key], type)}</dd></div>)}</dl>
    {note && <p className="employee-report-note">{note}</p>}
  </section>;
}

function DetailTable({ report, self = false }) {
  return <section className="employee-report-section"><h2>{report.title} <span>({report.rows.length})</span></h2>
    {report.rows.length ? <div className="employee-report-table-wrap"><table className="employee-report-table"><thead><tr>{report.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
      <tbody>{report.rows.map((row, index) => <tr key={row.id ?? index}>{report.columns.map((column) => <td key={column.key} className={['money', 'number'].includes(column.type) ? 'employee-report-numeric' : ''}>
        {column.key === 'reference' && ['loans', 'advances', 'activity'].includes(report.id) ? <Link to={row.reference.startsWith('ADV-') ? `/${self ? 'employee' : 'admin'}/advances?advance=${row.advance_id ?? row.id}` : `/${self ? 'employee' : 'admin'}/loans?loan=${row.advance_id ?? row.id}`}>{row.reference}</Link> : format(row[column.key], column.type)}
      </td>)}</tr>)}</tbody></table></div> : <p className="employee-report-note">No records for this selection.</p>}
    <p className="employee-report-note">{report.note}</p>
  </section>;
}

export default function EmployeeReports({ self = false }) {
  const { user } = useAuth();
  const { employeeId: requestedEmployeeId } = useParams();
  const employeeId = self ? String(user?.id || 'self') : requestedEmployeeId;
  const [params, setParams] = useSearchParams();
  const period = validPeriod(params.get('period')) ? params.get('period') : currentPeriod();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('');
  const [page, setPage] = useState(1);
  const periodLabel = new Date(`${period}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  useEffect(() => {
    if (!validPeriod(params.get('period'))) setParams({ period }, { replace: true });
  }, [params, period, setParams]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api.get(self ? '/reports/my' : '/reports', { params: { period }, signal: controller.signal })
      .then(({ data: result }) => { if (!controller.signal.aborted) setData(result); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.response?.data?.message || 'Unable to load employee reports. Please try again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, revision, self, employeeId]);
  useEffect(() => { setPage(1); }, [query, department, period]);
  const summaries = useMemo(() => buildEmployeeSummaries(data, period), [data, period]);
  const selected = employeeId ? summaries.find((row) => String(row.employee_id) === employeeId) : null;
  const detailReports = useMemo(() => selected ? employeeDetailReports(data, period, employeeId) : [], [data, period, employeeId, selected]);
  const departments = [...new Set(summaries.map((row) => row.department))].sort();
  const search = query.trim().toLowerCase();
  const filtered = summaries.filter((row) => (!department || row.department === department) && `${row.emp_code} ${row.name}`.toLowerCase().includes(search));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const activePage = Math.min(page, pages);
  const pageRows = filtered.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE);
  const canExport = !loading && !error && (employeeId ? !!selected : filtered.length > 0);

  function download() {
    if (!canExport) return;
    const metadata = { Period: periodLabel, Generated: data.generated_at };
    const csv = selected ? employeeReportCsv(selected, detailReports, metadata) : reportCsv({
      title: 'Employee monthly summaries', columns: employeeSummaryColumns, rows: filtered,
      note: 'Attendance, leave and salary relate to the selected month. Approved credit balances include repayments through the selected month.'
    }, metadata);
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `employee-report-${selected?.employee_id || 'all'}-${period}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const renderRows = (rows) => <table className="employee-report-table"><thead><tr>{employeeSummaryColumns.map((column) => <th key={column.key}>{column.label}</th>)}<th className="employee-report-controls">Details</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.employee_id}>{employeeSummaryColumns.map((column) => <td key={column.key} className={['money', 'number'].includes(column.type) ? 'employee-report-numeric' : ''}>
      {['name', 'emp_code'].includes(column.key) ? <Link to={`/admin/reports/employees/${row.employee_id}?period=${period}`}>{format(row[column.key], column.type)}</Link> : format(row[column.key], column.type)}
    </td>)}<td className="employee-report-controls"><Link to={`/admin/reports/employees/${row.employee_id}?period=${period}`}>View report</Link></td></tr>)}</tbody></table>;

  return <div className="reports-page employee-reports-page">
    <div className="employee-report-heading"><div>{!self && <Link className="employee-report-back employee-report-controls" to={employeeId ? `/admin/reports/employees?period=${period}` : `/admin/reports?period=${period}`}><FiArrowLeft />{employeeId ? 'All employee reports' : 'Back to Reports'}</Link>}
      <h1>{self ? 'My monthly report' : employeeId ? 'Monthly employee report' : 'Employee reports'}</h1><p>{periodLabel} · {self ? 'Your attendance, leave, salary, loans and advances for the selected month.' : employeeId ? 'Attendance, leave, salary, loans and advances for one employee.' : 'Select an employee to open their complete monthly report.'}</p></div>
      <div className="employee-report-actions employee-report-controls">
        <button className={`employee-report-action employee-report-action-refresh ${loading ? 'is-loading' : ''}`} type="button" disabled={loading} aria-busy={loading} onClick={() => setRevision((value) => value + 1)}><FiRefreshCw aria-hidden="true" /><span>{loading ? 'Refreshing...' : 'Refresh'}</span></button>
        <button className="employee-report-action employee-report-action-download" type="button" disabled={!canExport} onClick={download}><FiDownload aria-hidden="true" /><span>Download CSV</span></button>
        <button className="employee-report-action employee-report-action-print" type="button" disabled={!canExport} onClick={() => window.print()}><FiPrinter aria-hidden="true" /><span>Print / Save PDF</span></button>
      </div>
    </div>
    <div className="employee-report-filters employee-report-controls"><label>Report month<input type="month" min="2000-01" max="2100-12" value={period} onChange={(event) => { if (validPeriod(event.target.value)) { const next = new URLSearchParams(params); next.set('period', event.target.value); setParams(next); } }} /></label>
      {!employeeId && <><label>Department<select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">All departments</option>{departments.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label>Find employee<input type="search" value={query} placeholder="Employee ID or name" onChange={(event) => setQuery(event.target.value)} /></label></>}
    </div>
    {loading ? <p className="employee-report-state" role="status">Loading employee reports...</p> : error ? <div className="employee-report-state" role="alert"><p>{error}</p><button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button></div> : employeeId ? selected ? <article className="employee-report-document" aria-labelledby="employee-report-document-title">
      <header className="employee-report-document-header">
        <div><p className="employee-report-company">5 Gen Educon Private Limited</p><h2 id="employee-report-document-title">Monthly employee report</h2><p>Attendance, leave and payroll statement</p></div>
        <div className="employee-report-document-period"><span>Reporting month</span><strong>{periodLabel}</strong></div>
      </header>
      <section className="employee-report-identity"><h2>{selected.name}</h2><dl><div><dt>Employee ID</dt><dd>{selected.emp_code || selected.employee_id}</dd></div><div><dt>Department</dt><dd>{selected.department}</dd></div><div><dt>Designation</dt><dd>{selected.designation || '—'}</dd></div><div><dt>Current status</dt><dd>{selected.is_active ? 'Active' : 'Inactive'}</dd></div><div><dt>Joined</dt><dd>{format(selected.joining_date, 'date')}</dd></div><div><dt>Exit date</dt><dd>{format(selected.resignation_date, 'date')}</dd></div></dl></section>
      <dl className="employee-report-monthly-overview">{[
        ['present', 'Present days', 'number'], ['paid_leave', 'Paid leave days', 'number'],
        ['gross', 'Gross salary', 'money'], ['total_deductions', 'Total deductions', 'money'], ['net_pay', 'Take-home pay', 'money'],
      ].map(([key, label, type]) => <div key={key}><dt>{label}</dt><dd>{format(selected[key], type)}</dd></div>)}</dl>
      <Metrics title="Attendance counts" row={selected} fields={[
        ['attendance_records', 'Recorded days'], ['present', 'Present days'], ['paid_leave', 'Paid leave days'], ['unpaid', 'Unpaid days'], ['worked_hours', 'Worked hours'], ['missing_punches', 'Missing punches'], ['invalid_punches', 'Invalid punch pairs']
      ]} note="Half-day presence counts as 0.5 day. Days without attendance records are excluded." />
      <Metrics title="Leave counts and balance" row={selected} fields={[
        ['leave_requests', 'Total requests'], ['approved_leave_requests', 'Approved requests'], ['pending_leave_requests', 'Pending requests'], ['rejected_leave_requests', 'Rejected requests'],
        ['requested_days', 'Requested days'], ['approved_days', 'Approved days'], ['pending_days', 'Pending days'], ['rejected_days', 'Rejected days'], ['paid_allowance', 'Monthly paid allowance'], ['paid_balance', 'Paid days remaining']
      ]} note="Leave requests and days are separate counts. Only days within the selected month are included." />
      <Metrics title="Payroll and deductions" row={selected} fields={[
        ['payroll_status', 'Payslip status', 'text'], ['workflow_status', 'Approval status', 'text'], ['payment_status', 'Payment status', 'text'], ['paid_on', 'Payment date', 'date'], ['payment_reference', 'Payment reference', 'text'], ['employed_days', 'Employment days'], ['net_paid_days', 'Paid days'], ['payslip_count', 'Payslips generated'], ['basic', 'Basic salary', 'money'], ['hra', 'HRA', 'money'], ['special_allowance', 'Special allowance', 'money'], ['lta', 'LTA', 'money'], ['other_allowances', 'Other allowances', 'money'], ['allowances', 'Additional allowances', 'money'],
        ['gross', 'Gross salary', 'money'], ['epf', 'EPF', 'money'], ['professional_tax', 'Professional tax', 'money'], ['loan_deduction', 'Loan deduction', 'money'], ['advance_deduction', 'Advance deduction', 'money'], ['unpaid_leave_deduction', 'Loss Of Pay deduction', 'money'], ['additional_deductions', 'Additional deductions', 'money'], ['other_deductions', 'Other / Loss Of Pay total', 'money'], ['total_deductions', 'Total deductions', 'money'], ['net_pay', 'Take-home pay', 'money']
      ]} note="Amounts come from the saved payslip for this month. A missing payslip shows a dash." />
      <Metrics title="Loans and salary advances" row={selected} fields={[
        ['loan_requests', 'Loan requests through month'], ['approved_loans', 'Approved loans, including repaid'], ['pending_loans', 'Pending loans'], ['rejected_loans', 'Rejected loans'], ['completed_loans', 'Fully repaid loans'], ['loan_balance', 'Approved loan balance', 'money'], ['loan_recovered', 'Loans recovered through month', 'money'],
        ['advance_requests', 'Advance requests through month'], ['approved_advances', 'Approved advances, including repaid'], ['pending_advances', 'Pending advances'], ['rejected_advances', 'Rejected advances'], ['completed_advances', 'Fully repaid advances'], ['advance_balance', 'Approved advance balance', 'money'], ['advance_recovered', 'Advances recovered through month', 'money']
      ]} note="Requests created through this month and repayments saved through this month. Decision statuses are current. Pending and rejected requests are excluded from approved balances." />
      {detailReports.map((report) => <DetailTable key={report.id} report={report} self={self} />)}
      <footer className="employee-report-document-footer"><span>{selected.emp_code || selected.employee_id} · {selected.name} · {periodLabel}</span>{data?.generated_at && <span>Updated {new Date(data.generated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>}</footer>
    </article> : <div className="employee-report-state"><h2>{self ? 'Report unavailable' : 'Employee not found'}</h2><p>{self ? 'Your reporting records are unavailable. Please contact your payroll administrator.' : 'This employee is not available in the reporting records.'}</p>{!self && <Link to={`/admin/reports/employees?period=${period}`}>Open employee reports</Link>}</div> : <section className="employee-report-section"><h2>Employee monthly summaries <span>({filtered.length})</span></h2>
      <Link className="employee-report-back employee-report-controls" to={`/admin/reports?category=employees&period=${period}`}>View employee statistics and registers</Link>
      {filtered.length ? <><div className="employee-report-table-wrap employee-report-screen-table">{renderRows(pageRows)}</div><div className="employee-report-print-table">{renderRows(filtered)}</div>
        <div className="employee-report-pagination employee-report-controls"><span>Page {activePage} of {pages} · {filtered.length} employees</span><button type="button" disabled={activePage === 1} onClick={() => setPage(activePage - 1)}>Previous</button><button type="button" disabled={activePage === pages} onClick={() => setPage(activePage + 1)}>Next</button></div></> : <p className="employee-report-note">No employees match these filters.</p>}
      <p className="employee-report-note">Monthly attendance and leave counts are based on recorded data. Net pay comes from saved payslips. Credit balances include repayments through the selected month.</p>
    </section>}
    {!employeeId && !loading && !error && data?.generated_at && <p className="employee-report-note">5 Gen Educon Private Limited · Updated {new Date(data.generated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>}
  </div>;
}
