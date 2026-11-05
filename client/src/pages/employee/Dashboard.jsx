import CheckInCard from '../../components/CheckInCard';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { downloadPayslip } from '../../api';
import { useAuth } from '../../context/AuthContext';

import {
  FiAlertCircle,
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiDownload,
  FiEye,
  FiEyeOff,
  FiFileText,
  FiRefreshCw,
  FiXCircle,
} from 'react-icons/fi';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const formatCurrency = (n) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);

const formatDate = (value) => {
  if (!value) return '-';

  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );

  if (match) {
    const [, year, month, day] = match;

    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day)
    );

    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const formatLeaveType = (value) => {
  if (!value) return '-';

  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const getStatusClass = (status) => {
  switch (String(status || '').toLowerCase()) {
    case 'approved':
      return 'status-approved';

    case 'rejected':
      return 'status-rejected';

    case 'pending':
      return 'status-pending';

    default:
      return 'status-default';
  }
};

function StatCard({
  icon: Icon,
  label,
  value,
  description,
  type = 'blue',
}) {
  return (
    <div className={`employee-stat-card stat-${type}`}>
      <div className="stat-card-top">
        <div className="stat-icon">
          <Icon />
        </div>
      </div>

      <div className="stat-value">
        {value}
      </div>

      <div className="stat-label">
        {label}
      </div>

      {description && (
        <div className="stat-description">
          {description}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();

  const [slip, setSlip] = useState(null);
  const [leaves, setLeaves] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [downloading, setDownloading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hideSalary, setHideSalary] = useState(false);

  const loadDashboard = async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError('');

      const [slipRes, leaveRes] = await Promise.all([
        api.get('/payslips/my'),
        api.get('/leaves/my'),
      ]);

      const payslips = Array.isArray(slipRes.data)
        ? slipRes.data
        : [];

      const leaveData = Array.isArray(leaveRes.data)
        ? leaveRes.data
        : [];

      setSlip(
        payslips.length > 0
          ? payslips[0]
          : null
      );

      setLeaves(leaveData);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          'Failed to load dashboard data.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError('');

        const [slipRes, leaveRes] = await Promise.all([
          api.get('/payslips/my'),
          api.get('/leaves/my'),
        ]);

        if (cancelled) return;

        const payslips = Array.isArray(slipRes.data)
          ? slipRes.data
          : [];

        const leaveData = Array.isArray(leaveRes.data)
          ? leaveRes.data
          : [];

        setSlip(
          payslips.length > 0
            ? payslips[0]
            : null
        );

        setLeaves(leaveData);
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.response?.data?.message ||
              'Failed to load dashboard data.'
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDownload = async () => {
    if (!slip?.id || downloading) return;

    try {
      setDownloading(true);

      await downloadPayslip(slip.id);
    } catch (err) {
      window.alert(
        err?.response?.data?.message ||
          'Could not download payslip. Please try again.'
      );
    } finally {
      setDownloading(false);
    }
  };

  const pending = leaves.filter(
    (leave) => leave.status === 'pending'
  ).length;

  const approved = leaves.filter(
    (leave) => leave.status === 'approved'
  ).length;

  const rejected = leaves.filter(
    (leave) => leave.status === 'rejected'
  ).length;

  const recentLeaves = [...leaves]
    .sort(
      (a, b) =>
        new Date(
          b.created_at ||
            b.start_date ||
            0
        ) -
        new Date(
          a.created_at ||
            a.start_date ||
            0
        )
    )
    .slice(0, 5);

  const employeeName =
    user?.name || 'Employee';

  const firstName =
    employeeName.split(' ')[0] ||
    'Employee';

  if (loading) {
    return (
      <div className="employee-dashboard">
        <div className="dashboard-loading">
          <div className="loading-spinner">
            <FiRefreshCw />
          </div>

          <h3>Loading dashboard</h3>

          <p>
            Please wait while we load your payroll
            information.
          </p>
        </div>

        <style>{dashboardStyles}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="employee-dashboard">
        <div className="dashboard-error">
          <div className="dashboard-error-icon">
            <FiAlertCircle />
          </div>

          <div className="dashboard-error-content">
            <h3>Unable to load dashboard</h3>

            <p>{error}</p>

            <button
              className="retry-button"
              onClick={() => loadDashboard()}
            >
              <FiRefreshCw />
              Try again
            </button>
          </div>
        </div>

        <style>{dashboardStyles}</style>
      </div>
    );
  }

  return (
    <div className="employee-dashboard">
      {/* =====================================================
          PAGE HEADER
      ===================================================== */}

      <section className="dashboard-header">
        <div>
          <div className="dashboard-eyebrow">
            Employee Portal
          </div>

          <h1>
            Welcome back, {firstName}
          </h1>

          <p>
            Here's an overview of your payroll,
            payslips and leave requests.
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={() => loadDashboard(true)}
          disabled={refreshing}
          title="Refresh dashboard"
        >
          <FiRefreshCw
            className={
              refreshing
                ? 'refresh-spinning'
                : ''
            }
          />

          <span>
            {refreshing
              ? 'Refreshing...'
              : 'Refresh'}
          </span>
        </button>
      </section>

      <CheckInCard />

      {/* =====================================================
          STAT CARDS
      ===================================================== */}

      <nav className="design-employee-shortcuts" aria-label="Daily tasks">
        <Link to="/employee/attendance"><FiClock aria-hidden="true" />My attendance</Link>
        <Link to="/employee/leaves"><FiCalendar aria-hidden="true" />Request leave</Link>
        <Link to="/employee/payslips"><FiFileText aria-hidden="true" />View my pay</Link>
      </nav>

      <section className="employee-stats">
        <StatCard
          icon={FiClock}
          label="Pending Leave Requests"
          value={pending}
          description="Requests awaiting approval"
          type="orange"
        />

        <StatCard
          icon={FiCheckCircle}
          label="Approved Leaves"
          value={approved}
          description="Approved leave requests"
          type="green"
        />

        <StatCard
          icon={FiXCircle}
          label="Rejected Leaves"
          value={rejected}
          description="Rejected leave requests"
          type="red"
        />

        <StatCard
          icon={FiFileText}
          label="Payslips Available"
          value={slip ? 1 : 0}
          description={
            slip
              ? 'Latest payslip available'
              : 'No payslip generated'
          }
          type="blue"
        />
      </section>

      {/* =====================================================
          MAIN CONTENT
      ===================================================== */}

      <section className="dashboard-grid">
        {/* Latest Payslip */}
        <div className="dashboard-card payslip-card">
          <div className="card-header">
            <div>
              <div className="card-icon blue-icon">
                <FiFileText />
              </div>
            </div>

            <div className="card-heading">
              <h2>My latest payslip</h2>
              <p>
                Your most recent salary statement
              </p>
            </div>
            <button type="button" className="design-salary-toggle" aria-label={hideSalary ? 'Show salary amount' : 'Hide salary amount'} aria-pressed={hideSalary} onClick={() => setHideSalary(!hideSalary)}>
              {hideSalary ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
            </button>
          </div>

          {slip ? (
            <div className="payslip-content">
              <div className="payslip-period">
                <span>Salary period</span>

                <strong>
                  {MONTHS[
                    Number(slip.month) - 1
                  ] || slip.month}{' '}
                  {slip.year}
                </strong>
              </div>

              <div className="payslip-amount">
                <span>Net Pay</span>

                <strong>
                  {hideSalary ? '••••••' : formatCurrency(
                    slip.net_pay
                  )}
                </strong>
              </div>

              <div className="payslip-divider" />

              <div className="payslip-meta">
                <div>
                  <span>Employee</span>
                  <strong>
                    {user?.name || '-'}
                  </strong>
                </div>

                <div>
                  <span>Status</span>

                  <span className="payslip-status">
                    <FiCheckCircle />
                    Generated
                  </span>
                </div>
              </div>

              <button
                className="download-button"
                onClick={handleDownload}
                disabled={downloading}
              >
                {downloading ? (
                  <>
                    <span className="button-spinner" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <FiDownload />
                    Download Payslip
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="empty-payslip">
              <div className="empty-icon">
                <FiFileText />
              </div>

              <h3>No payslip available</h3>

              <p>
                Your payslip will appear here once
                it has been generated.
              </p>
            </div>
          )}
        </div>

        {/* Leave Summary */}
        <div className="dashboard-card leave-summary-card">
          <div className="card-header">
            <div className="card-icon purple-icon">
              <FiCalendar />
            </div>

            <div className="card-heading">
              <h2>Leave Summary</h2>
              <p>
                Overview of your leave requests
              </p>
            </div>
          </div>

          <div className="leave-summary-list">
            <div className="leave-summary-item">
              <div className="summary-item-left">
                <span className="summary-dot pending-dot" />
                <span>Pending</span>
              </div>

              <strong>{pending}</strong>
            </div>

            <div className="leave-summary-item">
              <div className="summary-item-left">
                <span className="summary-dot approved-dot" />
                <span>Approved</span>
              </div>

              <strong>{approved}</strong>
            </div>

            <div className="leave-summary-item">
              <div className="summary-item-left">
                <span className="summary-dot rejected-dot" />
                <span>Rejected</span>
              </div>

              <strong>{rejected}</strong>
            </div>
          </div>

          <div className="total-leaves">
            <div>
              <span>Total requests</span>

              <strong>
                {leaves.length}
              </strong>
            </div>

            <FiCalendar />
          </div>
        </div>
      </section>

      {/* =====================================================
          RECENT LEAVES
      ===================================================== */}

      <section className="dashboard-card recent-leaves-card">
        <div className="card-header recent-header">
          <div className="card-icon calendar-icon">
            <FiCalendar />
          </div>

          <div className="card-heading">
            <h2>Recent Leave Requests</h2>

            <p>
              Your latest leave applications
            </p>
          </div>
        </div>

        {recentLeaves.length === 0 ? (
          <div className="empty-leaves">
            <div className="empty-icon">
              <FiCalendar />
            </div>

            <h3>No leave requests yet</h3>

            <p>
              Your leave applications will appear
              here once you submit one.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop / Tablet Table */}
            <div className="leave-table-wrapper">
              <table className="leave-table">
                <thead>
                  <tr>
                    <th>Leave Type</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {recentLeaves.map((leave) => (
                    <tr key={leave.id}>
                      <td>
                        <div className="leave-type-cell">
                          <div className="leave-row-icon">
                            <FiCalendar />
                          </div>

                          <span>
                            {formatLeaveType(
                              leave.leave_type ||
                                leave.type
                            )}
                          </span>
                        </div>
                      </td>

                      <td>
                        {formatDate(
                          leave.start_date
                        )}
                      </td>

                      <td>
                        {formatDate(
                          leave.end_date
                        )}
                      </td>

                      <td>
                        <span
                          className={`status-badge ${getStatusClass(
                            leave.status
                          )}`}
                        >
                          {leave.status ===
                            'approved' && (
                            <FiCheckCircle />
                          )}

                          {leave.status ===
                            'rejected' && (
                            <FiXCircle />
                          )}

                          {leave.status ===
                            'pending' && (
                            <FiClock />
                          )}

                          {leave.status ||
                            'Unknown'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="leave-mobile-list">
              {recentLeaves.map((leave) => (
                <div
                  className="leave-mobile-card"
                  key={leave.id}
                >
                  <div className="mobile-leave-top">
                    <div className="leave-type-cell">
                      <div className="leave-row-icon">
                        <FiCalendar />
                      </div>

                      <strong>
                        {formatLeaveType(
                          leave.leave_type ||
                            leave.type
                        )}
                      </strong>
                    </div>

                    <span
                      className={`status-badge ${getStatusClass(
                        leave.status
                      )}`}
                    >
                      {leave.status ===
                        'approved' && (
                        <FiCheckCircle />
                      )}

                      {leave.status ===
                        'rejected' && (
                        <FiXCircle />
                      )}

                      {leave.status ===
                        'pending' && (
                        <FiClock />
                      )}

                      {leave.status ||
                        'Unknown'}
                    </span>
                  </div>

                  <div className="mobile-leave-dates">
                    <div>
                      <span>From</span>
                      <strong>
                        {formatDate(
                          leave.start_date
                        )}
                      </strong>
                    </div>

                    <div>
                      <span>To</span>
                      <strong>
                        {formatDate(
                          leave.end_date
                        )}
                      </strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* =====================================================
          STYLES
      ===================================================== */}

      <style>{dashboardStyles}</style>
    </div>
  );
}

const dashboardStyles = `
  /* =========================================================
     DASHBOARD
  ========================================================= */

  .employee-dashboard {
    width: 100%;
    max-width: 1500px;
    margin: 0 auto;
    padding: 4px 0 30px;
    color: #0f172a;
  }

  /* =========================================================
     HEADER
  ========================================================= */

  .dashboard-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 24px;
  }

  .dashboard-eyebrow {
    display: inline-flex;
    align-items: center;
    padding: 5px 9px;
    border-radius: 999px;
    background: #eef2ff;
    color: #4f46e5;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  .dashboard-header h1 {
    margin: 0;
    color: #0f172a;
    font-size: clamp(24px, 3vw, 32px);
    line-height: 1.15;
    font-weight: 750;
    letter-spacing: -0.035em;
  }

  .dashboard-header p {
    margin: 7px 0 0;
    color: #64748b;
    font-size: 13px;
    line-height: 1.55;
  }

  .refresh-button {
    flex-shrink: 0;

    height: 38px;
    padding: 0 13px;

    border: 1px solid #e2e8f0;
    border-radius: 9px;

    background: #ffffff;
    color: #475569;

    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;

    font-size: 11px;
    font-weight: 650;

    cursor: pointer;

    transition:
      border-color 0.18s ease,
      background 0.18s ease,
      color 0.18s ease;
  }

  .refresh-button:hover:not(:disabled) {
    border-color: #c7d2fe;
    background: #eef2ff;
    color: #4f46e5;
  }

  .refresh-button:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .refresh-button svg {
    width: 14px;
    height: 14px;
  }

  .refresh-spinning {
    animation: dashboard-spin 0.8s linear infinite;
  }

  @keyframes dashboard-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* =========================================================
     STAT CARDS
  ========================================================= */

  .employee-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
    margin-bottom: 18px;
  }

  .employee-stat-card {
    position: relative;
    min-width: 0;

    padding: 17px;

    background: #ffffff;

    border: 1px solid #e8edf4;
    border-radius: 13px;

    box-shadow:
      0 2px 8px rgba(15, 23, 42, 0.025);

    overflow: hidden;
  }

  .employee-stat-card::after {
    content: '';

    position: absolute;
    right: -28px;
    bottom: -30px;

    width: 90px;
    height: 90px;

    border-radius: 50%;

    opacity: 0.55;
    pointer-events: none;
  }

  .stat-blue::after {
    background: #e0e7ff;
  }

  .stat-orange::after {
    background: #ffedd5;
  }

  .stat-green::after {
    background: #dcfce7;
  }

  .stat-red::after {
    background: #fee2e2;
  }

  .stat-card-top {
    display: flex;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .stat-icon {
    width: 34px;
    height: 34px;

    border-radius: 9px;

    display: flex;
    align-items: center;
    justify-content: center;

    position: relative;
    z-index: 1;
  }

  .stat-icon svg {
    width: 16px;
    height: 16px;
  }

  .stat-blue .stat-icon {
    background: #eef2ff;
    color: #4f46e5;
  }

  .stat-orange .stat-icon {
    background: #fff7ed;
    color: #ea580c;
  }

  .stat-green .stat-icon {
    background: #ecfdf5;
    color: #059669;
  }

  .stat-red .stat-icon {
    background: #fef2f2;
    color: #dc2626;
  }

  .stat-value {
    position: relative;
    z-index: 1;

    color: #0f172a;

    font-size: 25px;
    line-height: 1;
    font-weight: 750;

    letter-spacing: -0.025em;

    margin-bottom: 6px;
  }

  .stat-label {
    position: relative;
    z-index: 1;

    color: #334155;

    font-size: 11px;
    font-weight: 700;

    line-height: 1.35;
  }

  .stat-description {
    position: relative;
    z-index: 1;

    margin-top: 4px;

    color: #94a3b8;

    font-size: 9px;
    line-height: 1.4;
  }

  /* =========================================================
     MAIN GRID
  ========================================================= */

  .dashboard-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.65fr);
    gap: 18px;
    margin-bottom: 18px;
  }

  .dashboard-card {
    background: #ffffff;

    border: 1px solid #e8edf4;
    border-radius: 14px;

    box-shadow:
      0 2px 8px rgba(15, 23, 42, 0.025);
  }

  .payslip-card,
  .leave-summary-card {
    min-width: 0;
    padding: 20px;
  }

  /* =========================================================
     CARD HEADER
  ========================================================= */

  .card-header {
    display: flex;
    align-items: flex-start;
    gap: 11px;

    margin-bottom: 20px;
  }

  .card-icon {
    width: 36px;
    height: 36px;
    min-width: 36px;

    border-radius: 9px;

    display: flex;
    align-items: center;
    justify-content: center;
  }

  .card-icon svg {
    width: 17px;
    height: 17px;
  }

  .blue-icon {
    background: #eef2ff;
    color: #4f46e5;
  }

  .purple-icon {
    background: #f5f3ff;
    color: #7c3aed;
  }

  .calendar-icon {
    background: #eef2ff;
    color: #4f46e5;
  }

  .card-heading {
    min-width: 0;
  }

  .card-heading h2 {
    margin: 1px 0 0;

    color: #0f172a;

    font-size: 14px;
    font-weight: 750;

    line-height: 1.3;
  }

  .card-heading p {
    margin: 3px 0 0;

    color: #94a3b8;

    font-size: 10px;
    line-height: 1.45;
  }

  /* =========================================================
     PAYSLIP
  ========================================================= */

  .payslip-content {
    min-width: 0;
  }

  .payslip-period {
    display: flex;
    align-items: center;
    justify-content: space-between;

    gap: 20px;

    margin-bottom: 14px;
  }

  .payslip-period span,
  .payslip-amount span {
    color: #94a3b8;
    font-size: 10px;
  }

  .payslip-period strong {
    color: #334155;
    font-size: 11px;
    font-weight: 700;
    text-align: right;
  }

  .payslip-amount {
    padding: 16px;

    border-radius: 11px;

    background:
      linear-gradient(
        135deg,
        #eef2ff 0%,
        #f8fafc 100%
      );

    border: 1px solid #e0e7ff;
  }

  .payslip-amount span {
    display: block;
    margin-bottom: 6px;
  }

  .payslip-amount strong {
    display: block;

    color: #4338ca;

    font-size: clamp(25px, 3vw, 31px);
    line-height: 1.1;
    font-weight: 800;

    letter-spacing: -0.035em;
  }

  .payslip-divider {
    height: 1px;
    background: #eef2f7;
    margin: 16px 0;
  }

  .payslip-meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;

    margin-bottom: 17px;
  }

  .payslip-meta > div {
    min-width: 0;
  }

  .payslip-meta span:first-child {
    display: block;

    color: #94a3b8;

    font-size: 9px;
    margin-bottom: 4px;
  }

  .payslip-meta strong {
    display: block;

    color: #334155;

    font-size: 10px;
    font-weight: 700;

    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .payslip-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;

    color: #059669 !important;

    font-size: 10px !important;
    font-weight: 650;
  }

  .payslip-status svg {
    width: 12px;
    height: 12px;
  }

  .download-button {
    width: 100%;
    height: 40px;

    border: none;
    border-radius: 9px;

    background: #4f46e5;
    color: #ffffff;

    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;

    font-size: 11px;
    font-weight: 650;

    cursor: pointer;

    box-shadow:
      0 5px 14px rgba(79, 70, 229, 0.18);

    transition:
      background 0.18s ease,
      transform 0.18s ease;
  }

  .download-button:hover:not(:disabled) {
    background: #4338ca;
    transform: translateY(-1px);
  }

  .download-button:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .download-button svg {
    width: 14px;
    height: 14px;
  }

  .button-spinner {
    width: 13px;
    height: 13px;

    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #ffffff;

    border-radius: 50%;

    animation: dashboard-spin 0.7s linear infinite;
  }

  /* =========================================================
     LEAVE SUMMARY
  ========================================================= */

  .leave-summary-list {
    display: flex;
    flex-direction: column;

    border-top: 1px solid #eef2f7;
  }

  .leave-summary-item {
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding: 13px 0;

    border-bottom: 1px solid #eef2f7;
  }

  .summary-item-left {
    display: flex;
    align-items: center;
    gap: 9px;

    color: #475569;

    font-size: 11px;
    font-weight: 550;
  }

  .summary-item-left strong {
    color: #0f172a;
  }

  .summary-dot {
    width: 8px;
    height: 8px;

    border-radius: 50%;
  }

  .pending-dot {
    background: #f59e0b;
  }

  .approved-dot {
    background: #10b981;
  }

  .rejected-dot {
    background: #ef4444;
  }

  .leave-summary-item > strong {
    color: #0f172a;

    font-size: 15px;
    font-weight: 750;
  }

  .total-leaves {
    display: flex;
    align-items: center;
    justify-content: space-between;

    margin-top: 14px;
    padding: 12px;

    border-radius: 9px;

    background: #f8fafc;
  }

  .total-leaves > div {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .total-leaves span {
    color: #94a3b8;
    font-size: 9px;
  }

  .total-leaves strong {
    color: #334155;
    font-size: 14px;
  }

  .total-leaves > svg {
    width: 18px;
    height: 18px;
    color: #64748b;
  }

  /* =========================================================
     RECENT LEAVES
  ========================================================= */

  .recent-leaves-card {
    padding: 20px;
    overflow: hidden;
  }

  .recent-header {
    margin-bottom: 15px;
  }

  .leave-table-wrapper {
    width: 100%;
    overflow-x: auto;
  }

  .leave-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 580px;
  }

  .leave-table th {
    padding: 10px 12px;

    color: #94a3b8;

    background: #f8fafc;

    border-top: 1px solid #eef2f7;
    border-bottom: 1px solid #eef2f7;

    font-size: 9px;
    font-weight: 700;

    text-align: left;

    white-space: nowrap;
  }

  .leave-table td {
    padding: 13px 12px;

    color: #475569;

    border-bottom: 1px solid #f1f5f9;

    font-size: 10px;

    white-space: nowrap;
  }

  .leave-table tbody tr:last-child td {
    border-bottom: none;
  }

  .leave-table tbody tr:hover {
    background: #fafcff;
  }

  .leave-type-cell {
    display: flex;
    align-items: center;
    gap: 8px;

    color: #334155;

    font-weight: 650;
  }

  .leave-row-icon {
    width: 27px;
    height: 27px;
    min-width: 27px;

    border-radius: 7px;

    background: #f1f5f9;
    color: #64748b;

    display: flex;
    align-items: center;
    justify-content: center;
  }

  .leave-row-icon svg {
    width: 13px;
    height: 13px;
  }

  /* =========================================================
     STATUS
  ========================================================= */

  .status-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;

    gap: 5px;

    min-width: 72px;

    padding: 5px 8px;

    border-radius: 999px;

    font-size: 9px;
    font-weight: 700;

    text-transform: capitalize;
  }

  .status-badge svg {
    width: 11px;
    height: 11px;
  }

  .status-approved {
    background: #ecfdf5;
    color: #047857;
  }

  .status-rejected {
    background: #fef2f2;
    color: #b91c1c;
  }

  .status-pending {
    background: #fffbeb;
    color: #b45309;
  }

  .status-default {
    background: #f1f5f9;
    color: #475569;
  }

  /* =========================================================
     MOBILE LEAVE LIST
  ========================================================= */

  .leave-mobile-list {
    display: none;
  }

  /* =========================================================
     EMPTY STATES
  ========================================================= */

  .empty-payslip,
  .empty-leaves {
    min-height: 190px;

    display: flex;
    flex-direction: column;

    align-items: center;
    justify-content: center;

    text-align: center;

    padding: 20px;
  }

  .empty-icon {
    width: 42px;
    height: 42px;

    border-radius: 11px;

    background: #f1f5f9;
    color: #94a3b8;

    display: flex;
    align-items: center;
    justify-content: center;

    margin-bottom: 10px;
  }

  .empty-icon svg {
    width: 19px;
    height: 19px;
  }

  .empty-payslip h3,
  .empty-leaves h3 {
    margin: 0;

    color: #334155;

    font-size: 12px;
    font-weight: 700;
  }

  .empty-payslip p,
  .empty-leaves p {
    max-width: 300px;

    margin: 5px 0 0;

    color: #94a3b8;

    font-size: 9px;
    line-height: 1.5;
  }

  /* =========================================================
     LOADING
  ========================================================= */

  .dashboard-loading {
    min-height: 60vh;

    display: flex;
    flex-direction: column;

    align-items: center;
    justify-content: center;

    text-align: center;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;

    border-radius: 11px;

    background: #eef2ff;
    color: #4f46e5;

    display: flex;
    align-items: center;
    justify-content: center;

    margin-bottom: 13px;
  }

  .loading-spinner svg {
    width: 18px;
    height: 18px;

    animation: dashboard-spin 0.8s linear infinite;
  }

  .dashboard-loading h3 {
    margin: 0;

    color: #334155;

    font-size: 13px;
  }

  .dashboard-loading p {
    margin: 5px 0 0;

    color: #94a3b8;

    font-size: 10px;
  }

  /* =========================================================
     ERROR
  ========================================================= */

  .dashboard-error {
    min-height: 45vh;

    display: flex;
    align-items: center;
    justify-content: center;

    gap: 13px;

    padding: 25px;
  }

  .dashboard-error-icon {
    width: 42px;
    height: 42px;
    min-width: 42px;

    border-radius: 11px;

    background: #fef2f2;
    color: #dc2626;

    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dashboard-error-icon svg {
    width: 19px;
    height: 19px;
  }

  .dashboard-error-content h3 {
    margin: 0;

    color: #334155;

    font-size: 13px;
  }

  .dashboard-error-content p {
    margin: 4px 0 10px;

    color: #64748b;

    font-size: 10px;
  }

  .retry-button {
    height: 34px;

    padding: 0 11px;

    border: 1px solid #fecaca;
    border-radius: 8px;

    background: #ffffff;
    color: #b91c1c;

    display: inline-flex;
    align-items: center;
    gap: 6px;

    font-size: 10px;
    font-weight: 650;

    cursor: pointer;
  }

  .retry-button:hover {
    background: #fef2f2;
  }

  .retry-button svg {
    width: 13px;
    height: 13px;
  }

  /* =========================================================
     TABLET
  ========================================================= */

  @media (max-width: 1100px) {
    .employee-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .dashboard-grid {
      grid-template-columns: 1fr;
    }
  }

  /* =========================================================
     MOBILE
  ========================================================= */

  @media (max-width: 700px) {
    .employee-dashboard {
      padding: 0 0 25px;
    }

    .dashboard-header {
      align-items: flex-start;
      margin-bottom: 18px;
    }

    .dashboard-header h1 {
      font-size: 23px;
    }

    .dashboard-header p {
      font-size: 11px;
    }

    .refresh-button {
      width: 36px;
      padding: 0;
    }

    .refresh-button span {
      display: none;
    }

    .employee-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }

    .employee-stat-card {
      padding: 13px;
      border-radius: 11px;
    }

    .stat-icon {
      width: 30px;
      height: 30px;
    }

    .stat-icon svg {
      width: 14px;
      height: 14px;
    }

    .stat-value {
      font-size: 21px;
    }

    .stat-label {
      font-size: 10px;
    }

    .stat-description {
      display: none;
    }

    .dashboard-grid {
      gap: 12px;
      margin-bottom: 12px;
    }

    .payslip-card,
    .leave-summary-card,
    .recent-leaves-card {
      padding: 15px;
      border-radius: 11px;
    }

    .card-header {
      margin-bottom: 15px;
    }

    .card-icon {
      width: 32px;
      height: 32px;
      min-width: 32px;
    }

    .card-icon svg {
      width: 15px;
      height: 15px;
    }

    .card-heading h2 {
      font-size: 12px;
    }

    .card-heading p {
      font-size: 9px;
    }

    .payslip-amount {
      padding: 13px;
    }

    .payslip-amount strong {
      font-size: 25px;
    }

    .payslip-meta {
      gap: 10px;
    }

    .leave-table-wrapper {
      display: none;
    }

    .leave-mobile-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .leave-mobile-card {
      padding: 11px;

      border: 1px solid #eef2f7;
      border-radius: 9px;

      background: #fafcff;
    }

    .mobile-leave-top {
      display: flex;
      align-items: center;
      justify-content: space-between;

      gap: 10px;

      margin-bottom: 10px;
    }

    .mobile-leave-top .leave-type-cell {
      min-width: 0;
    }

    .mobile-leave-top .leave-type-cell strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      font-size: 10px;
    }

    .mobile-leave-dates {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;

      padding-top: 9px;

      border-top: 1px solid #eef2f7;
    }

    .mobile-leave-dates div {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .mobile-leave-dates span {
      color: #94a3b8;
      font-size: 8px;
    }

    .mobile-leave-dates strong {
      color: #475569;
      font-size: 9px;
      font-weight: 650;
    }

    .status-badge {
      min-width: 65px;
      padding: 4px 7px;
      font-size: 8px;
    }
  }

  /* =========================================================
     SMALL MOBILE
  ========================================================= */

  @media (max-width: 420px) {
    .dashboard-header {
      gap: 10px;
    }

    .dashboard-header h1 {
      font-size: 20px;
    }

    .dashboard-header p {
      max-width: 270px;
      font-size: 10px;
    }

    .dashboard-eyebrow {
      font-size: 8px;
      padding: 4px 7px;
    }

    .employee-stats {
      gap: 8px;
    }

    .employee-stat-card {
      padding: 11px;
    }

    .stat-card-top {
      margin-bottom: 9px;
    }

    .stat-value {
      font-size: 19px;
    }

    .stat-label {
      font-size: 9px;
    }

    .payslip-period {
      gap: 10px;
    }

    .payslip-amount strong {
      font-size: 23px;
    }

    .payslip-meta {
      grid-template-columns: 1fr;
      gap: 9px;
    }

    .download-button {
      height: 38px;
    }
  }
`;
