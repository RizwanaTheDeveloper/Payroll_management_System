import { useEffect, useState } from 'react';
import { FiCalendar, FiClipboard, FiClock, FiSend } from 'react-icons/fi';
import { FaHandHoldingUsd, FaRupeeSign } from 'react-icons/fa';
import api from '../../api';
import AttendanceApprovals from '../../components/AttendanceApprovals';
import { StatCard } from '../../components/ui';
import '../manager/Team.css';

// Everything waiting on an administrator, in one place. Requests with a manager appear here only
// once they are ready for final approval or have waited past the escalation window.
const TILES = [
  ['payroll_awaiting_approval', 'Payroll awaiting approval', '/admin/payroll', FiClipboard],
  ['leave_pending', 'Leave requests', '/admin/leaves', FiCalendar],
  ['loans_pending', 'Loans ready for approval', '/admin/loans', FaHandHoldingUsd],
  ['advances_pending', 'Advances ready for approval', '/admin/advances', FaRupeeSign],
  ['attendance_requests_pending', 'Attendance corrections', '/admin/approvals', FiClock],
  ['payroll_to_publish', 'Approved payslips to publish', '/admin/payroll', FiSend],
];

export default function Approvals() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    api.get('/notifications').then(({ data }) => setInfo(data)).catch(() => setInfo({ counts: {} }));
  }, []);

  const counts = info?.counts || {};
  return (
    <div className="team-page">
      <div>
        <h1>Approvals</h1>
        <p className="team-sub">
          Managers decide their team's leave and attendance requests first and recommend loans and advances; payroll they prepare comes here for approval.
          {info?.escalate_after_days ? ` Anything undecided for ${info.escalate_after_days} days is escalated to you.` : ''}
        </p>
      </div>
      <div className="team-stats" data-count="6">
        {TILES.map(([key, label, to, icon]) => (
          <StatCard key={key} icon={icon} tone="purple" label={label} value={counts[key] ?? '-'} to={to} alert={counts[key] > 0} />
        ))}
      </div>
      <AttendanceApprovals endpoint="/attendance-requests?status=pending" admin />
    </div>
  );
}
