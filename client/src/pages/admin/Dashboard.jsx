import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

import {
  FiUsers,
  FiClipboard,
  FiCalendar,
  FiClock,
  FiUserPlus,
  FiFileText,
  FiCheckCircle,
  FiRefreshCw,
  FiArrowRight,
  FiInbox,
  FiAlertCircle
} from 'react-icons/fi';

const money = (v) =>
  v == null
    ? '-'
    : '₹' + Number(v).toLocaleString('en-IN');


const fmtDate = (v) => {
  const d = String(v || '').slice(0, 10);

  if (!d) return '-';

  const [y, m, dd] = d.split('-').map(Number);

  return new Date(y, m - 1, dd).toLocaleDateString(
    'en-IN',
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }
  );
};


export default function Dashboard() {
  const [s, setS] = useState({});
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');


  const load = async () => {
    try {
      setLoading(true);

      const [stats, leaves] = await Promise.all([
        api.get('/employees/stats'),
        api.get('/leaves', {
          params: {
            status: 'pending'
          }
        })
      ]);

      setS(stats.data || {});

      setPending(
        Array.isArray(leaves.data)
          ? leaves.data.slice(0, 5)
          : []
      );

      setError('');
    } catch (e) {
      setError(
        e.response?.data?.message ||
        'Failed to load dashboard data.'
      );
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    load();

    // Refresh every 60 seconds
    const id = setInterval(
      load,
      60000
    );

    return () => clearInterval(id);
  }, []);


  /* ---------------------------------------
     Dashboard statistics
  --------------------------------------- */

  const items = [
    {
      label: 'Total Employees',
      value: s.headcount,
      icon: FiUsers,
      color: 'blue',
      to: '/admin/employees'
    },
    {
      label: 'Pending Leaves',
      value: s.pendingLeaves,
      icon: FiCalendar,
      color: 'amber',
      to: '/admin/leaves'
    },
    {
      label: 'Present Today',
      value: s.presentToday,
      icon: FiClock,
      color: 'green',
      to: '/admin/attendance'
    },
    {
      label: 'Monthly Payroll',
      value: money(s.monthlyPayroll),
      icon: FiClipboard,
      color: 'purple',
      to: '/admin/payroll'
    }
  ];


  /* ---------------------------------------
     Quick actions
  --------------------------------------- */

  const quick = [
    {
      to: '/admin/employees',
      label: 'Add Employee',
      description: 'Create a new employee profile',
      icon: FiUserPlus
    },
    {
      to: '/admin/payroll',
      label: 'Generate Payslips',
      description: 'Create monthly employee payslips',
      icon: FiFileText
    },
    {
      to: '/admin/leaves',
      label: 'Review Leaves',
      description: 'Approve or reject leave requests',
      icon: FiCheckCircle
    },
    {
      to: '/admin/attendance',
      label: 'Mark Attendance',
      description: 'Manage employee attendance',
      icon: FiClock
    }
  ];


  return (
    <div className="admin-dashboard">


      {/* =====================================
          PAGE HEADER
      ===================================== */}

      <div className="page-head">
        <div>
          <h1>Payroll overview</h1>

          <p>
            {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            {' · Workforce, attendance and payroll'}
          </p>
        </div>

        <div className="design-overview-actions">
        <Link to="/admin/payroll" className="design-primary-link"><FiArrowRight aria-hidden="true" />Open payroll</Link>
        <button
          className="secondary dashboard-refresh"
          type="button"
          onClick={load}
          disabled={loading}
        >
          <FiRefreshCw
            className={
              loading
                ? 'refresh-spin'
                : ''
            }
          />

          <span>
            {loading
              ? 'Refreshing...'
              : 'Refresh'}
          </span>
        </button>
        </div>
      </div>


      {/* =====================================
          ERROR
      ===================================== */}

      {error && (
        <div className="dashboard-error">
          <FiAlertCircle />

          <span>{error}</span>
        </div>
      )}


      {/* =====================================
          STATISTICS
      ===================================== */}

      <div className="stats dashboard-stats">

        {items.map((it) => {
          const Icon = it.icon;

          return (
            <Link
              to={it.to}
              key={it.label}
              className="dashboard-stat-link"
            >
              <div
                className={`stat dashboard-stat ${it.color}`}
              >

                <div className="stat-icon">
                  <Icon />
                </div>

                <div className="stat-content">

                  <div className="stat-label">
                    {it.label}
                  </div>

                  <div className="stat-value">
                    {loading
                      ? '...'
                      : it.value ?? '-'}
                  </div>

                </div>

                <FiArrowRight className="stat-arrow" />

              </div>
            </Link>
          );
        })}

      </div>


      {/* =====================================
          QUICK ACTIONS
      ===================================== */}

      <div className="card dashboard-card">

        <div className="card-head dashboard-section-head">

          <div>
            <h3>Quick Actions</h3>

            <p>
              Frequently used administration
              functions
            </p>
          </div>

        </div>


        <div className="quick-actions">

          {quick.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                key={item.to}
                to={item.to}
                className="quick-action"
              >

                <div className="quick-action-icon">
                  <Icon />
                </div>

                <div className="quick-action-content">

                  <div className="quick-action-title">
                    {item.label}
                  </div>

                  <div className="quick-action-description">
                    {item.description}
                  </div>

                </div>

                <FiArrowRight className="quick-action-arrow" />

              </Link>
            );
          })}

        </div>

      </div>


      {/* =====================================
          PENDING LEAVES
      ===================================== */}

      <div className="card dashboard-card">

        <div className="card-head dashboard-section-head">

          <div>
            <div className="section-title-row">

              <h3>
                Your action queue · Leave requests
              </h3>

              {pending.length > 0 && (
                <span className="pending-badge">
                  {pending.length}
                </span>
              )}

            </div>

            <p>
              Leave requests waiting for
              administrative action
            </p>
          </div>


          <Link
            to="/admin/leaves"
            className="view-all-link"
          >
            View all
            <FiArrowRight />
          </Link>

        </div>


        {loading ? (

          <div className="dashboard-empty">
            <div className="loading-spinner" />

            <p>
              Loading leave requests...
            </p>
          </div>

        ) : pending.length === 0 ? (

          <div className="dashboard-empty">

            <div className="empty-icon">
              <FiInbox />
            </div>

            <h4>
              No pending requests
            </h4>

            <p>
              There are currently no leave
              requests waiting for approval.
            </p>

          </div>

        ) : (

          <div className="table-wrapper">

            <table className="dashboard-table">

              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Leave Type</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Reason</th>
                </tr>
              </thead>

              <tbody>

                {pending.map((l) => (

                  <tr key={l.id}>

                    <td>
                      <div className="employee-cell">

                        <div className="employee-avatar">
                          {String(
                            l.employee_name || 'E'
                          )
                            .charAt(0)
                            .toUpperCase()}
                        </div>

                        <div>
                          <div className="employee-name">
                            {l.employee_name || '-'}
                          </div>

                          {l.emp_code && (
                            <div className="employee-code">
                              {l.emp_code}
                            </div>
                          )}
                        </div>

                      </div>
                    </td>


                    <td>
                      <span
                        className={`leave-type leave-${String(
                          l.leave_type || ''
                        ).toLowerCase()}`}
                      >
                        {l.leave_type || '-'}
                      </span>
                    </td>


                    <td>
                      <span className="date-cell">
                        {fmtDate(l.start_date)}
                      </span>
                    </td>


                    <td>
                      <span className="date-cell">
                        {fmtDate(l.end_date)}
                      </span>
                    </td>


                    <td>
                      <span className="reason-cell">
                        {l.reason || '-'}
                      </span>
                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        )}

      </div>


      {/* =====================================
          DASHBOARD STYLES
      ===================================== */}

      <style>{`

        .admin-dashboard {
          width: 100%;
        }


        /* ===============================
           PAGE HEADER
        =============================== */

        .page-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 28px;
        }

        .page-head h1 {
          margin: 0 0 6px;
          font-size: 28px;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -0.4px;
        }

        .page-head p {
          margin: 0;
          color: #64748b;
          font-size: 14px;
        }


        .dashboard-refresh {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-width: 110px;
        }

        .dashboard-refresh svg {
          width: 16px;
          height: 16px;
        }

        .refresh-spin {
          animation: dashboard-spin 1s linear infinite;
        }

        @keyframes dashboard-spin {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }


        /* ===============================
           ERROR
        =============================== */

        .dashboard-error {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 13px 16px;
          margin-bottom: 20px;
          border: 1px solid #fecaca;
          border-radius: 10px;
          background: #fef2f2;
          color: #b91c1c;
          font-size: 14px;
        }

        .dashboard-error svg {
          flex-shrink: 0;
          width: 18px;
          height: 18px;
        }


        /* ===============================
           STAT CARDS
        =============================== */

        .dashboard-stats {
          display: grid;
          grid-template-columns:
            repeat(4, minmax(0, 1fr));
          gap: 18px;
          margin-bottom: 24px;
        }

        .dashboard-stat-link {
          text-decoration: none;
          color: inherit;
          min-width: 0;
        }

        .dashboard-stat {
          position: relative;
          min-height: 116px;
          display: flex;
          align-items: center;
          gap: 15px;
          padding: 20px;
          border-radius: 14px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          overflow: hidden;
          transition:
            transform 0.2s ease,
            box-shadow 0.2s ease,
            border-color 0.2s ease;
        }

        .dashboard-stat:hover {
          transform: translateY(-2px);
          box-shadow:
            0 8px 24px rgba(15, 23, 42, 0.08);
          border-color: #cbd5e1;
        }

        .dashboard-stat::after {
          content: '';
          position: absolute;
          right: -25px;
          top: -35px;
          width: 100px;
          height: 100px;
          border-radius: 50%;
          opacity: 0.06;
        }


        .stat-icon {
          width: 48px;
          height: 48px;
          min-width: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          font-size: 22px;
        }

        .stat-icon svg {
          width: 22px;
          height: 22px;
        }


        .dashboard-stat.blue .stat-icon {
          background: #eef2ff;
          color: #4f46e5;
        }

        .dashboard-stat.amber .stat-icon {
          background: #fffbeb;
          color: #d97706;
        }

        .dashboard-stat.green .stat-icon {
          background: #f0fdf4;
          color: #16a34a;
        }

        .dashboard-stat.purple .stat-icon {
          background: #faf5ff;
          color: #9333ea;
        }


        .dashboard-stat.blue::after {
          background: #4f46e5;
        }

        .dashboard-stat.amber::after {
          background: #d97706;
        }

        .dashboard-stat.green::after {
          background: #16a34a;
        }

        .dashboard-stat.purple::after {
          background: #9333ea;
        }


        .stat-content {
          min-width: 0;
          flex: 1;
        }

        .stat-label {
          margin-bottom: 6px;
          color: #64748b;
          font-size: 13px;
          font-weight: 500;
        }

        .stat-value {
          color: #0f172a;
          font-size: 24px;
          font-weight: 700;
          line-height: 1.1;
        }

        .stat-arrow {
          color: #94a3b8;
          width: 17px;
          height: 17px;
          flex-shrink: 0;
          transition:
            transform 0.2s ease,
            color 0.2s ease;
        }

        .dashboard-stat:hover .stat-arrow {
          transform: translateX(3px);
          color: #475569;
        }


        /* ===============================
           CARDS
        =============================== */

        .dashboard-card {
          margin-bottom: 24px;
          overflow: hidden;
        }

        .dashboard-section-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }

        .dashboard-section-head h3 {
          margin: 0;
          color: #0f172a;
          font-size: 17px;
          font-weight: 650;
        }

        .dashboard-section-head p {
          margin: 5px 0 0;
          color: #64748b;
          font-size: 13px;
        }


        /* ===============================
           QUICK ACTIONS
        =============================== */

        .quick-actions {
          display: grid;
          grid-template-columns:
            repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .quick-action {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 15px;
          border: 1px solid #e2e8f0;
          border-radius: 11px;
          background: #ffffff;
          text-decoration: none;
          color: inherit;
          transition:
            border-color 0.2s ease,
            background 0.2s ease,
            transform 0.2s ease;
        }

        .quick-action:hover {
          border-color: #c7d2fe;
          background: #f8faff;
          transform: translateY(-1px);
        }

        .quick-action-icon {
          width: 40px;
          height: 40px;
          min-width: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          background: #eef2ff;
          color: #4f46e5;
        }

        .quick-action-icon svg {
          width: 19px;
          height: 19px;
        }

        .quick-action-content {
          min-width: 0;
          flex: 1;
        }

        .quick-action-title {
          color: #0f172a;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 3px;
        }

        .quick-action-description {
          color: #64748b;
          font-size: 11px;
          line-height: 1.35;
        }

        .quick-action-arrow {
          flex-shrink: 0;
          width: 15px;
          height: 15px;
          color: #94a3b8;
        }


        /* ===============================
           SECTION TITLE
        =============================== */

        .section-title-row {
          display: flex;
          align-items: center;
          gap: 9px;
        }

        .pending-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 22px;
          height: 22px;
          padding: 0 7px;
          border-radius: 999px;
          background: #fef3c7;
          color: #92400e;
          font-size: 11px;
          font-weight: 700;
        }

        .view-all-link {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: #4f46e5;
          font-size: 13px;
          font-weight: 600;
          text-decoration: none;
          white-space: nowrap;
        }

        .view-all-link:hover {
          color: #3730a3;
        }

        .view-all-link svg {
          width: 14px;
          height: 14px;
        }


        /* ===============================
           TABLE
        =============================== */

        .table-wrapper {
          width: 100%;
          overflow-x: auto;
        }

        .dashboard-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 700px;
        }

        .dashboard-table th {
          padding: 12px 16px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          color: #64748b;
          font-size: 11px;
          font-weight: 650;
          text-align: left;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          white-space: nowrap;
        }

        .dashboard-table td {
          padding: 13px 16px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
          font-size: 13px;
          vertical-align: middle;
        }

        .dashboard-table tbody tr:last-child td {
          border-bottom: none;
        }

        .dashboard-table tbody tr {
          transition: background 0.15s ease;
        }

        .dashboard-table tbody tr:hover {
          background: #f8fafc;
        }


        /* ===============================
           EMPLOYEE CELL
        =============================== */

        .employee-cell {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .employee-avatar {
          width: 34px;
          height: 34px;
          min-width: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: #eef2ff;
          color: #4f46e5;
          font-size: 12px;
          font-weight: 700;
        }

        .employee-name {
          color: #0f172a;
          font-weight: 600;
        }

        .employee-code {
          margin-top: 2px;
          color: #94a3b8;
          font-size: 11px;
        }


        /* ===============================
           LEAVE TYPE
        =============================== */

        .leave-type {
          display: inline-flex;
          align-items: center;
          padding: 5px 9px;
          border-radius: 999px;
          background: #f1f5f9;
          color: #475569;
          font-size: 11px;
          font-weight: 600;
          text-transform: capitalize;
        }

        .leave-casual {
          background: #eef2ff;
          color: #4338ca;
        }

        .leave-sick {
          background: #fef2f2;
          color: #b91c1c;
        }

        .leave-paid {
          background: #f0fdf4;
          color: #15803d;
        }


        .date-cell {
          color: #475569;
          white-space: nowrap;
        }

        .reason-cell {
          display: block;
          max-width: 220px;
          overflow: hidden;
          color: #64748b;
          text-overflow: ellipsis;
          white-space: nowrap;
        }


        /* ===============================
           EMPTY / LOADING
        =============================== */

        .dashboard-empty {
          min-height: 180px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 30px;
          text-align: center;
        }

        .dashboard-empty p {
          margin: 8px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .dashboard-empty h4 {
          margin: 12px 0 0;
          color: #334155;
          font-size: 15px;
        }

        .empty-icon {
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: #f1f5f9;
          color: #64748b;
        }

        .empty-icon svg {
          width: 21px;
          height: 21px;
        }

        .loading-spinner {
          width: 25px;
          height: 25px;
          border: 3px solid #e2e8f0;
          border-top-color: #4f46e5;
          border-radius: 50%;
          animation: dashboard-spin 0.8s linear infinite;
        }


        /* ===============================
           RESPONSIVE
        =============================== */

        @media (max-width: 1100px) {

          .dashboard-stats {
            grid-template-columns:
              repeat(2, minmax(0, 1fr));
          }

          .quick-actions {
            grid-template-columns:
              repeat(2, minmax(0, 1fr));
          }

        }


        @media (max-width: 700px) {

          .page-head {
            align-items: flex-start;
            flex-direction: column;
          }

          .page-head h1 {
            font-size: 24px;
          }

          .dashboard-refresh {
            width: 100%;
          }

          .dashboard-stats {
            grid-template-columns: 1fr;
            gap: 12px;
          }

          .quick-actions {
            grid-template-columns: 1fr;
          }

          .dashboard-section-head {
            align-items: flex-start;
            flex-direction: column;
          }

          .view-all-link {
            margin-top: 2px;
          }

          .dashboard-card {
            margin-bottom: 16px;
          }

        }

      `}</style>

    </div>
  );
}
