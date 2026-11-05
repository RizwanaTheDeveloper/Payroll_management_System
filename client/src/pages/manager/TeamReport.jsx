import { useEffect, useState } from 'react';
import { FiUsers } from 'react-icons/fi';
import api from '../../api';
import { EmptyState, Skeleton } from '../../components/ui';
import './Team.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const HEADERS = [
  ['emp_code', 'Employee ID'], ['name', 'Name'], ['present_days', 'Present'], ['absent_days', 'Absent'],
  ['leave_days', 'Leave'], ['paid_leave_days', 'Paid leave'], ['approved_requests', 'Approved'],
  ['pending_requests', 'Pending'], ['rejected_requests', 'Rejected'],
];

// Guard against spreadsheet formula injection in exported text.
const csvCell = (value) => {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export default function TeamReport() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    api.get('/team/report', { params: { month, year } })
      .then((response) => { if (!cancelled) setReport(response.data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.message || 'Unable to load the team report.'); });
    return () => { cancelled = true; };
  }, [month, year]);

  function exportCsv() {
    const lines = [HEADERS.map(([, label]) => csvCell(label)).join(',')];
    report.members.forEach((member) => lines.push(HEADERS.map(([key]) => csvCell(member[key])).join(',')));
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `team-report-${year}-${String(month).padStart(2, '0')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="team-page">
      <div className="team-head">
        <div>
          <h1>Team report</h1>
          <p className="team-sub">Monthly attendance and leave for your direct reports. Salary information is not included.</p>
        </div>
        <div className="team-controls">
          <select aria-label="Month" value={month} onChange={(event) => setMonth(Number(event.target.value))}>
            {MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
          </select>
          <input aria-label="Year" type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(Number(event.target.value))} style={{ width: 90 }} />
          <button className="team-btn" type="button" disabled={!report?.members.length} onClick={exportCsv}>Export CSV</button>
          <button className="team-btn" type="button" onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </div>
      {error && <p className="team-msg error" role="alert">{error}</p>}
      <section className="team-card">
        <h2>{MONTHS[month - 1]} {year}</h2>
        {!report ? <Skeleton rows={4} /> : report.members.length === 0 ? <EmptyState icon={FiUsers} title="No team members yet">An administrator assigns team members from Admin &rarr; Employees.</EmptyState> : (
          <div className="team-scroll"><table className="team-nowrap">
            <thead><tr>{HEADERS.map(([key, label], index) => <th key={key} className={index > 1 ? 'num' : undefined}>{label}</th>)}</tr></thead>
            <tbody>{report.members.map((member) => (
              <tr key={member.id}>{HEADERS.map(([key], index) => <td key={key} className={index > 1 ? 'num' : undefined}>{member[key]}</td>)}</tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="team-empty">Present, absent and leave are days of marked attendance; Approved, Pending and Rejected count leave requests overlapping the month. Unmarked days are not counted.</p>
      </section>
    </div>
  );
}
