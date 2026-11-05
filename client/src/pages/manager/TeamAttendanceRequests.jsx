import AttendanceApprovals from '../../components/AttendanceApprovals';
import './Team.css';

export default function TeamAttendanceRequests() {
  return (
    <div className="team-page">
      <div>
        <h1>Attendance corrections</h1>
        <p className="team-sub">Corrections your team has asked for. Approving records the day as present, with your name as the approver. Requests for a month whose payroll is finalized need an administrator.</p>
      </div>
      <AttendanceApprovals endpoint="/attendance-requests/team" />
    </div>
  );
}
