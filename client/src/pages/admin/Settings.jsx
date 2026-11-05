import { Link, useSearchParams } from 'react-router-dom';
import { FiInfo } from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import ChangePassword from '../../components/ChangePassword';

const sections = [
  ['company', 'Company'],
  ['payroll', 'Payroll policies'],
  ['attendance', 'Attendance'],
  ['leave', 'Leave'],
  ['access', 'Roles & access'],
  ['notifications', 'Notifications'],
];

const permissions = [
  ['Manage employee records', 'All employees', 'No'],
  ['View payslips', 'All employees', 'Own payslips'],
  ['Prepare payroll', 'Yes', 'No'],
  ['Review attendance', 'All employees', 'Own records'],
  ['Request leave', 'Own requests', 'Own requests'],
  ['Request loans', 'No', 'Own requests'],
  ['Approve leave and loans', 'Yes', 'No'],
  ['View reports and exports', 'All employees', 'Own monthly report'],
];

const employeeDetails = {
  payroll: { title: 'My payroll', description: 'View your salary statements, deductions, payment status and monthly reports. Salary changes are managed by your payroll administrator.', links: [['/employee/payslips', 'My payslips'], ['/employee/reports', 'My monthly report']] },
  attendance: { title: 'My attendance', description: 'View your recorded attendance and hours. Contact your administrator if a record needs correcting.', links: [['/employee/attendance', 'My attendance']] },
  leave: { title: 'My leave', description: 'Submit leave requests and review your approval status, rejection reasons and remaining paid leave.', links: [['/employee/leaves', 'My leave requests']] },
  notifications: { title: 'Request updates', description: 'Check leave, loan and advance decisions in your portal. Notification preferences are not available yet.', links: [['/employee/leaves', 'Leave updates'], ['/employee/loans', 'Loan updates'], ['/employee/advances', 'Advance updates']] },
};

const details = {
  payroll: {
    title: 'Payroll policies',
    description: 'Manage salary components and deductions in employee records. Generate monthly payslips from the Payroll workspace.',
    links: [['/admin/employees', 'Manage salary details'], ['/admin/payroll', 'Open payroll']],
  },
  attendance: {
    title: 'Attendance management',
    description: 'Review daily attendance and mark full or half days in the Attendance workspace.',
    links: [['/admin/attendance', 'Open attendance']],
  },
  leave: {
    title: 'Leave management',
    description: 'Review employee leave requests and approve or reject them in the Leave workspace.',
    links: [['/admin/leaves', 'Open leave requests']],
  },
  notifications: {
    title: 'Notifications',
    description: 'Notification preferences are not available yet. Employees can check request outcomes and published payslips in their portal.',
    links: [],
  },
};

export default function Settings() {
  const { user } = useAuth();
  const isEmployee = user?.role !== 'admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get('section');
  const section = sections.some(([key]) => key === requestedSection) ? requestedSection : isEmployee ? 'company' : 'access';
  const detail = (isEmployee ? employeeDetails : details)[section];

  return (
    <div className="settings-page">
      <div className="settings-heading">
        <h1>Settings</h1>
        <p>{isEmployee ? 'Your account, payroll information and portal access' : 'Company policies and access controls'}</p>
      </div>

      <nav className="settings-tabs" aria-label="Settings sections">
        {sections.map(([key, label]) => (
          <button key={key} type="button" className={section === key ? 'is-active' : ''}
            aria-current={section === key ? 'page' : undefined}
            onClick={() => setSearchParams({ section: key })}>{isEmployee && key === 'company' ? 'Company & account' : isEmployee && key === 'access' ? 'My access' : label}</button>
        ))}
      </nav>

      <section className="settings-card" aria-labelledby="settings-section-title">
        <div className="settings-card-heading">
          <h2 id="settings-section-title">{section === 'access' ? 'Roles and permissions' : section === 'company' ? 'Company workspace' : detail.title}</h2>
        </div>
        {section === 'access' ? (
          <>
            <div className="settings-table-scroll">
              <table>
                <thead><tr><th scope="col">Permission</th>{!isEmployee && <th scope="col">Administrator</th>}<th scope="col">{isEmployee ? 'Your access' : 'Employee'}</th></tr></thead>
                <tbody>{permissions.map(([permission, admin, employee]) => (
                  <tr key={permission}><th scope="row">{permission}</th>{!isEmployee && <td>{admin}</td>}<td>{employee}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <p className="settings-footnote">Current access is determined by the account’s administrator or employee role.</p>
          </>
        ) : section === 'company' ? (
          <div className="settings-details">
            <dl><div><dt>Workspace</dt><dd>5 Gen Payroll</dd></div><div><dt>Company</dt><dd>5 Gen Educon Private Limited</dd></div><div><dt>Signed in as</dt><dd>{user?.name || 'User'}</dd></div><div><dt>Account role</dt><dd>{user?.role === 'manager' ? 'Manager' : isEmployee ? 'Employee' : 'Administrator'}</dd></div></dl>
            {isEmployee ? <><p>Contact your payroll administrator to update your personal details, bank information or salary structure.</p><Link className="settings-action" to="/employee/reports">View my monthly report</Link></> : <Link className="settings-action" to="/admin/employees">Manage employees</Link>}
          </div>
        ) : (
          <div className="settings-details">
            <p>{detail.description}</p>
            <div className="settings-actions">{detail.links.map(([to, label]) => <Link key={to} className="settings-action" to={to}>{label}</Link>)}</div>
          </div>
        )}
      </section>

      {section === 'company' && <section className="settings-card"><div className="settings-card-heading"><h2>Change password</h2></div><ChangePassword heading={false} /></section>}

      {!isEmployee && <div className="settings-info"><FiInfo aria-hidden="true" /><div>
        <strong>{section === 'access' ? 'Account access' : 'Workspace settings'}</strong>
        <p>{section === 'access' ? 'This overview shows the current roles. Custom roles and editable permissions are not available yet.' : 'Use the linked workspaces to manage records. Company-wide policy editing is not available yet.'}</p>
      </div></div>}
    </div>
  );
}
