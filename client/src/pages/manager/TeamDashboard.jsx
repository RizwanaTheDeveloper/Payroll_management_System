import { useEffect, useState } from 'react';
import { FiCalendar, FiClock, FiHelpCircle, FiRefreshCw, FiUserCheck, FiUserX, FiUsers } from 'react-icons/fi';
import { FaRupeeSign } from 'react-icons/fa';
import api from '../../api';
import { EmptyState, Skeleton, StatCard } from '../../components/ui';
import './Team.css';

const STATUS = {
  present: ['Present', 'ok'],
  absent: ['Absent', 'bad'],
  leave: ['On leave', 'warn'],
  paid_leave: ['Paid leave', 'warn'],
};

function todayStatus(member) {
  if (member.today_status && STATUS[member.today_status]) return STATUS[member.today_status];
  if (member.on_leave_today) return ['On leave', 'warn'];
  return ['Not marked', ''];
}

const formatDate = (value) => new Date(`${String(value).slice(0, 10)}T00:00:00`)
  .toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

export default function TeamDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    api.get('/team/summary')
      .then((response) => setData(response.data))
      .catch((err) => setError(err.response?.data?.message || 'Unable to load your team.'));
  };
  useEffect(load, []);

  if (error) return <div className="team-page"><p className="team-msg error" role="alert">{error}</p></div>;
  if (!data) return <div className="team-page"><h1>My team</h1><div className="team-card"><Skeleton rows={6} /></div></div>;

  const credit = data.pending_loans + data.pending_advances;
  return (
    <div className="team-page">
      <div className="team-head">
        <div>
          <h1>My team</h1>
          <p className="team-sub">{data.team_size} direct report{data.team_size === 1 ? '' : 's'} · today at a glance</p>
        </div>
        <button className="team-btn" type="button" onClick={load}><FiRefreshCw aria-hidden="true" /> Refresh</button>
      </div>

      <section className="team-section" aria-labelledby="team-today">
        <h2 className="team-section-title" id="team-today">Today</h2>
        <div className="team-stats" data-count="4">
          <StatCard icon={FiUserCheck} tone="green" label="Present" value={data.present_today} />
          <StatCard icon={FiCalendar} tone="blue" label="On leave" value={data.on_leave_today} />
          <StatCard icon={FiUserX} tone="red" label="Absent" value={data.absent_today} />
          <StatCard icon={FiHelpCircle} tone="amber" label="Not marked yet" value={data.not_marked_today} to="/employee/team-attendance" alert={data.not_marked_today > 0} />
        </div>
      </section>

      <section className="team-section" aria-labelledby="team-attention">
        <h2 className="team-section-title" id="team-attention">Needs your attention</h2>
        <div className="team-stats" data-count="3">
          <StatCard icon={FiClock} tone="purple" label="Attendance corrections" value={data.pending_attendance_requests} to="/employee/team-attendance-requests" alert={data.pending_attendance_requests > 0} />
          <StatCard icon={FiCalendar} tone="purple" label="Leave requests to decide" value={data.pending_leaves} to="/employee/team-leaves" alert={data.pending_leaves > 0} />
          <StatCard icon={FaRupeeSign} tone="purple" label="Loans and advances to review" value={credit} to="/employee/team-requests" alert={credit > 0} />
        </div>
      </section>

      <section className="team-card">
        <h2>Team today</h2>
        {data.members.length === 0 ? (
          <EmptyState icon={FiUsers} title="No one reports to you yet">An administrator assigns team members from Admin &rarr; Employees. They will appear here once assigned.</EmptyState>
        ) : (
          <div className="team-scroll"><table>
            <thead><tr><th>Employee</th><th>Designation</th><th>Today</th><th>Pending leave</th></tr></thead>
            <tbody>{data.members.map((member) => {
              const [label, tone] = todayStatus(member);
              return (
                <tr key={member.id}>
                  <td>{member.name}<div className="team-sub">{member.emp_code}</div></td>
                  <td>{member.designation || <span className="team-muted">Not set</span>}</td>
                  <td><span className={`team-badge ${tone}`}>{label}</span></td>
                  <td>{member.pending_leaves ? <span className="team-badge warn">{member.pending_leaves} pending</span> : <span className="team-muted">None</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>

      <section className="team-card">
        <h2>Upcoming approved leave (next 14 days)</h2>
        {data.upcoming_leave.length === 0 ? (
          <EmptyState icon={FiCalendar} title="No upcoming leave">Approved leave in the next two weeks will show here.</EmptyState>
        ) : (
          <div className="team-scroll"><table>
            <thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th></tr></thead>
            <tbody>{data.upcoming_leave.map((leave) => (
              <tr key={leave.id}><td>{leave.name}</td><td style={{ textTransform: 'capitalize' }}>{leave.leave_type}</td><td>{formatDate(leave.start_date)}</td><td>{formatDate(leave.end_date)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
