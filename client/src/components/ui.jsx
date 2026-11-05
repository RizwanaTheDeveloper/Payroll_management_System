import { Link } from 'react-router-dom';
import { FiChevronRight, FiInbox } from 'react-icons/fi';
import '../pages/manager/Team.css';

// Small shared building blocks so every screen shows counts, empty and loading states the same way.

export function StatCard({ icon: Icon, label, value, tone = 'blue', to, alert = false }) {
  const body = (
    <>
      <span className={`team-stat-icon tone-${tone}`}><Icon aria-hidden="true" /></span>
      <div><strong>{value}</strong><span className="team-stat-label">{label}</span></div>
      {to && <FiChevronRight className="team-stat-go" aria-hidden="true" />}
    </>
  );
  const className = `team-stat ${alert ? 'is-alert' : ''} ${value === 0 || value === '0' ? 'is-zero' : ''}`;
  return to ? <Link className={className} to={to}>{body}</Link> : <div className={className}>{body}</div>;
}

export function EmptyState({ icon: Icon = FiInbox, title, children }) {
  return (
    <div className="team-empty-state">
      <span className="team-empty-icon"><Icon aria-hidden="true" /></span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Skeleton({ rows = 4 }) {
  return (
    <div className="team-skeleton" role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, index) => <span key={index} />)}
    </div>
  );
}
