import { useEffect, useMemo, useState } from 'react';
import api from '../../api';
import LeaveDocuments from '../../components/LeaveDocuments';
import {
  FiCalendar,
  FiCheck,
  FiX,
  FiClock,
  FiUsers,
  FiCheckCircle,
  FiXCircle,
  FiList,
  FiRefreshCw,
  FiAlertCircle,
} from 'react-icons/fi';

const TABS = [
  { key: 'all', label: 'All', icon: FiList },
  { key: 'pending', label: 'Pending', icon: FiClock },
  { key: 'approved', label: 'Approved', icon: FiCheckCircle },
  { key: 'rejected', label: 'Rejected', icon: FiXCircle },
];

const days = (leave) => {
  if (!leave.start_date || !leave.end_date) return 0;

  const a = new Date(
    String(leave.start_date).slice(0, 10)
  );

  const b = new Date(
    String(leave.end_date).slice(0, 10)
  );

  return Math.round((b - a) / 864e5) + 1;
};

const formatDate = (value) => {
  if (!value) return '-';

  const date = new Date(
    String(value).slice(0, 10)
  );

  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 10);
  }

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const capitalize = (value) => {
  if (!value) return '-';

  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

export default function Leaves({ team = false }) {
  const [list, setList] = useState([]);
  const [tab, setTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [rejectingLeave, setRejectingLeave] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setError('');

      const response = await api.get(team ? '/leaves/team' : '/leaves');

      setList(
        Array.isArray(response.data)
          ? response.data
          : []
      );
    } catch (err) {
      console.error(err);

      setError(
        err.response?.data?.message ||
          'Failed to load leave requests.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const decide = async (id, status, reason = '') => {
    if (status === 'rejected' && !reason.trim()) {
      setError('Please enter a reason for rejecting this leave request.');
      return;
    }

    try {
      setProcessingId(id);
      setError('');
      setSuccess('');

      await api.patch(`/leaves/${id}/status`, {
        status,
        ...(status === 'rejected' && { rejection_reason: reason.trim() }),
      });

      if (status === 'rejected') {
        setRejectingLeave(null);
        setRejectionReason('');
      }

      setSuccess(
        status === 'approved'
          ? 'Leave request approved successfully.'
          : 'Leave request rejected successfully.'
      );

      await load();
    } catch (err) {
      console.error(err);

      setError(
        err.response?.data?.message ||
          `Failed to ${status} leave request.`
      );
    } finally {
      setProcessingId(null);
    }
  };

  const count = (status) => {
    if (status === 'all') {
      return list.length;
    }

    return list.filter(
      (leave) => leave.status === status
    ).length;
  };

  const shown = useMemo(() => {
    if (tab === 'all') {
      return list;
    }

    return list.filter(
      (leave) => leave.status === tab
    );
  }, [list, tab]);

  return (
    <div className="leaves-page">
      <style>{`
        .leaves-page {
          width: 100%;
          min-width: 0;
          padding: 4px 0 30px;
        }

        .leaves-page *,
        .leaves-page *::before,
        .leaves-page *::after {
          box-sizing: border-box;
        }

        .leaves-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 22px;
          flex-wrap: wrap;
        }

        .leaves-title-wrap {
          min-width: 0;
        }

        .leaves-title {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          color: #0f172a;
          font-size: 26px;
          font-weight: 750;
          line-height: 1.2;
        }

        .leaves-title-icon {
          width: 42px;
          height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          background: #eef2ff;
          color: #4f46e5;
          flex-shrink: 0;
        }

        .leaves-subtitle {
          margin: 7px 0 0 52px;
          color: #64748b;
          font-size: 14px;
        }

        .leaves-refresh-btn {
          min-height: 40px;
          padding: 0 13px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          border: 1px solid #cbd5e1;
          border-radius: 9px;
          background: #fff;
          color: #475569;
          cursor: pointer;
          font-size: 13px;
          font-weight: 650;
          transition: 0.18s ease;
        }

        .leaves-refresh-btn:hover {
          background: #f8fafc;
          border-color: #94a3b8;
        }

        .leaves-summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 22px;
        }

        .leaves-summary-card {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
          padding: 16px;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 13px;
          box-shadow: 0 3px 12px rgba(15, 23, 42, 0.035);
        }

        .leaves-summary-icon {
          width: 39px;
          height: 39px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          flex-shrink: 0;
        }

        .leaves-summary-icon.all {
          background: #eef2ff;
          color: #4f46e5;
        }

        .leaves-summary-icon.pending {
          background: #fffbeb;
          color: #d97706;
        }

        .leaves-summary-icon.approved {
          background: #f0fdf4;
          color: #16a34a;
        }

        .leaves-summary-icon.rejected {
          background: #fef2f2;
          color: #dc2626;
        }

        .leaves-summary-content {
          min-width: 0;
        }

        .leaves-summary-label {
          color: #64748b;
          font-size: 11px;
          font-weight: 600;
        }

        .leaves-summary-value {
          margin-top: 3px;
          color: #0f172a;
          font-size: 19px;
          font-weight: 750;
        }

        .leaves-card {
          width: 100%;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          box-shadow: 0 4px 18px rgba(15, 23, 42, 0.045);
          overflow: hidden;
        }

        .leaves-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 15px;
          padding: 18px 20px;
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
          flex-wrap: wrap;
        }

        .leaves-card-heading {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .leaves-card-heading-icon {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 9px;
          background: #eef2ff;
          color: #4f46e5;
        }

        .leaves-card-heading h3 {
          margin: 0;
          color: #0f172a;
          font-size: 16px;
          font-weight: 700;
        }

        .leaves-card-heading p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 12px;
        }

        .leaves-tabs {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 16px 20px;
          border-bottom: 1px solid #e2e8f0;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        .leaves-tab {
          min-height: 36px;
          padding: 0 11px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          background: #fff;
          color: #64748b;
          cursor: pointer;
          font-size: 12px;
          font-weight: 650;
          white-space: nowrap;
          transition: 0.18s ease;
        }

        .leaves-tab:hover {
          background: #f8fafc;
          color: #334155;
        }

        .leaves-tab.active {
          border-color: #4f46e5;
          background: #4f46e5;
          color: #fff;
          box-shadow: 0 4px 10px rgba(79, 70, 229, 0.16);
        }

        .leaves-tab-count {
          min-width: 20px;
          height: 20px;
          padding: 0 5px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #f1f5f9;
          color: #475569;
          font-size: 10px;
          font-weight: 750;
        }

        .leaves-tab.active .leaves-tab-count {
          background: rgba(255, 255, 255, 0.2);
          color: #fff;
        }

        .leaves-message {
          margin: 16px 20px 0;
          padding: 11px 13px;
          border-radius: 9px;
          display: flex;
          align-items: center;
          gap: 9px;
          font-size: 13px;
        }

        .leaves-message.success {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #166534;
        }

        .leaves-message.error {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #b91c1c;
        }

        .leaves-table-wrapper {
          width: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
        }

        .leaves-table {
          width: 100%;
          min-width: 980px;
          border-collapse: collapse;
          table-layout: fixed;
        }

        .leaves-table th {
          padding: 13px 14px;
          background: #fff;
          border-bottom: 1px solid #e2e8f0;
          color: #475569;
          font-size: 11px;
          font-weight: 750;
          text-transform: uppercase;
          letter-spacing: 0.035em;
          text-align: left;
          white-space: nowrap;
        }

        .leaves-table td {
          padding: 14px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
          font-size: 13px;
          vertical-align: middle;
        }

        .leaves-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .leaves-table tbody tr:hover {
          background: #f8fafc;
        }

        .leaves-table th:nth-child(1),
        .leaves-table td:nth-child(1) {
          width: 15%;
        }

        .leaves-table th:nth-child(2),
        .leaves-table td:nth-child(2) {
          width: 8%;
        }

        .leaves-table th:nth-child(3),
        .leaves-table td:nth-child(3),
        .leaves-table th:nth-child(4),
        .leaves-table td:nth-child(4) {
          width: 9%;
        }

        .leaves-table th:nth-child(5),
        .leaves-table td:nth-child(5) {
          width: 5%;
        }

        .leaves-table th:nth-child(6),
        .leaves-table td:nth-child(6) {
          width: 18%;
        }

        .leaves-table th:nth-child(7),
        .leaves-table td:nth-child(7) {
          width: 14%;
        }

        .leaves-table th:nth-child(8),
        .leaves-table td:nth-child(8) {
          width: 22%;
        }

        .leave-employee {
          display: flex;
          align-items: center;
          gap: 9px;
          min-width: 0;
        }

        .leave-avatar {
          width: 34px;
          height: 34px;
          border-radius: 9px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #eef2ff;
          color: #4f46e5;
          flex: 0 0 34px;
        }

        .leave-employee-info {
          min-width: 0;
        }

        .leave-employee-name {
          color: #0f172a;
          font-weight: 700;
          overflow-wrap: anywhere;
          line-height: 1.3;
        }

        .leave-employee-code {
          margin-top: 2px;
          color: #94a3b8;
          font-size: 11px;
        }

        .leave-type {
          color: #334155;
          font-weight: 600;
          white-space: nowrap;
        }

        .leave-date {
          color: #475569;
          white-space: nowrap;
        }

        .leave-days {
          display: inline-flex;
          min-width: 28px;
          height: 26px;
          padding: 0 7px;
          align-items: center;
          justify-content: center;
          border-radius: 7px;
          background: #f1f5f9;
          color: #334155;
          font-weight: 700;
        }

        .leave-reason {
          color: #64748b;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .leave-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-height: 27px;
          padding: 0 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 750;
          text-transform: capitalize;
          white-space: nowrap;
        }

        .leave-status.pending {
          background: #fffbeb;
          color: #b45309;
        }

        .leave-status.approved {
          background: #f0fdf4;
          color: #15803d;
        }

        .leave-status.rejected {
          background: #fef2f2;
          color: #b91c1c;
        }

        .leave-actions {
          display: flex;
          align-items: center;
          gap: 7px;
          width: 100%;
          white-space: nowrap;
        }

        .leave-action-btn {
          min-height: 34px;
          padding: 0 9px;
          border-radius: 8px;
          border: 1px solid;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          cursor: pointer;
          font-size: 11px;
          font-weight: 700;
          transition: 0.18s ease;
          white-space: nowrap;
        }

        .leave-approve-btn {
          background: #f0fdf4;
          border-color: #bbf7d0;
          color: #15803d;
        }

        .leave-approve-btn:hover {
          background: #dcfce7;
          border-color: #86efac;
        }

        .leave-reject-btn {
          background: #fef2f2;
          border-color: #fecaca;
          color: #dc2626;
        }

        .leave-reject-btn:hover {
          background: #fee2e2;
          border-color: #fca5a5;
        }

        .leave-action-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .leave-processed {
          color: #94a3b8;
          font-size: 12px;
        }

        .leave-rejection-reason {
          margin-top: 8px;
          color: #b91c1c;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          line-height: 1.5;
        }

        .leave-rejection-form {
          margin: 16px 20px;
          padding: 16px;
          border: 1px solid #fecaca;
          border-radius: 10px;
          background: #fff7f7;
        }

        .leave-rejection-form label {
          display: block;
          margin-bottom: 8px;
          color: #991b1b;
          font-weight: 650;
        }

        .leave-rejection-form textarea {
          width: 100%;
          min-height: 90px;
          padding: 10px;
          margin-bottom: 10px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          font: inherit;
          resize: vertical;
        }

        .leaves-empty {
          padding: 55px 20px;
          text-align: center;
          color: #64748b;
        }

        .leaves-empty-icon {
          width: 48px;
          height: 48px;
          margin: 0 auto 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          background: #f1f5f9;
          color: #64748b;
        }

        .leaves-empty-title {
          color: #334155;
          font-weight: 700;
          margin-bottom: 5px;
        }

        .leaves-empty-text {
          font-size: 13px;
        }

        .leaves-loading {
          padding: 45px 20px;
          text-align: center;
          color: #64748b;
        }

        .leaves-loading-spinner {
          width: 26px;
          height: 26px;
          margin: 0 auto 10px;
          border: 3px solid #e2e8f0;
          border-top-color: #4f46e5;
          border-radius: 50%;
          animation: leavesSpin 0.8s linear infinite;
        }

        .leaves-refresh-spin {
          animation: leavesSpin 0.8s linear infinite;
        }

        @keyframes leavesSpin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1050px) {
          .leaves-summary-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 720px) {
          .leaves-title {
            font-size: 22px;
          }

          .leaves-title-icon {
            width: 38px;
            height: 38px;
          }

          .leaves-subtitle {
            margin-left: 48px;
          }

          .leaves-refresh-btn {
            width: 100%;
          }

          .leaves-summary-grid {
            grid-template-columns: 1fr;
          }

          .leaves-card-header {
            align-items: flex-start;
          }

          .leaves-tabs {
            padding: 13px 14px;
          }

          .leaves-message {
            margin-left: 14px;
            margin-right: 14px;
          }

          .leaves-table {
            min-width: 950px;
          }
        }
      `}</style>

      {/* PAGE HEADER */}
      <div className="leaves-header">
        <div className="leaves-title-wrap">
          <h1 className="leaves-title">
            <span className="leaves-title-icon">
              <FiCalendar size={21} />
            </span>

            {team ? 'Team Leave Requests' : 'Leave Requests'}
          </h1>

          <p className="leaves-subtitle">
            {count('pending')} request
            {count('pending') === 1 ? '' : 's'} waiting
            for your decision
          </p>
        </div>

        <button
          type="button"
          className="leaves-refresh-btn"
          onClick={load}
          disabled={loading}
        >
          <FiRefreshCw
            size={15}
            className={
              loading ? 'leaves-refresh-spin' : ''
            }
          />

          Refresh
        </button>
      </div>

      {/* SUMMARY */}
      <div className="leaves-summary-grid">
        <div className="leaves-summary-card">
          <div className="leaves-summary-icon all">
            <FiList size={18} />
          </div>

          <div className="leaves-summary-content">
            <div className="leaves-summary-label">
              Total Requests
            </div>

            <div className="leaves-summary-value">
              {count('all')}
            </div>
          </div>
        </div>

        <div className="leaves-summary-card">
          <div className="leaves-summary-icon pending">
            <FiClock size={18} />
          </div>

          <div className="leaves-summary-content">
            <div className="leaves-summary-label">
              Pending
            </div>

            <div className="leaves-summary-value">
              {count('pending')}
            </div>
          </div>
        </div>

        <div className="leaves-summary-card">
          <div className="leaves-summary-icon approved">
            <FiCheckCircle size={18} />
          </div>

          <div className="leaves-summary-content">
            <div className="leaves-summary-label">
              Approved
            </div>

            <div className="leaves-summary-value">
              {count('approved')}
            </div>
          </div>
        </div>

        <div className="leaves-summary-card">
          <div className="leaves-summary-icon rejected">
            <FiXCircle size={18} />
          </div>

          <div className="leaves-summary-content">
            <div className="leaves-summary-label">
              Rejected
            </div>

            <div className="leaves-summary-value">
              {count('rejected')}
            </div>
          </div>
        </div>
      </div>

      {/* MAIN CARD */}
      <div className="leaves-card">
        <div className="leaves-card-header">
          <div className="leaves-card-heading">
            <div className="leaves-card-heading-icon">
              <FiUsers size={18} />
            </div>

            <div>
              <h3>{team ? 'Requests from your team' : 'Employee Leave Requests'}</h3>

              <p>
                {team ? 'Approve or reject leave for your direct reports' : 'Review and manage employee leave applications'}
              </p>
            </div>
          </div>
        </div>

        {/* TABS */}
        <div className="leaves-tabs">
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;

            return (
              <button
                key={item.key}
                type="button"
                className={`leaves-tab ${
                  active ? 'active' : ''
                }`}
                onClick={() => setTab(item.key)}
              >
                <Icon size={14} />

                {item.label}

                <span className="leaves-tab-count">
                  {count(item.key)}
                </span>
              </button>
            );
          })}
        </div>

        {/* SUCCESS MESSAGE */}
        {success && (
          <div className="leaves-message success">
            <FiCheckCircle size={17} />

            <span>{success}</span>
          </div>
        )}

        {/* ERROR MESSAGE */}
        {error && (
          <div className="leaves-message error">
            <FiAlertCircle size={17} />

            <span>{error}</span>
          </div>
        )}

        {rejectingLeave && (
          <form
            className="leave-rejection-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (processingId !== null) return;
              decide(rejectingLeave.id, 'rejected', rejectionReason);
            }}
          >
            <label htmlFor="leave-rejection-reason">
              Reason for rejecting {rejectingLeave.name || 'this employee'}’s leave
              {' '}({formatDate(rejectingLeave.start_date)} – {formatDate(rejectingLeave.end_date)})
            </label>
            <textarea
              id="leave-rejection-reason"
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Explain why this leave request is being rejected"
              required
              autoFocus
              disabled={processingId !== null}
            />
            <div className="leave-actions">
              <button
                type="submit"
                className="leave-action-btn leave-reject-btn"
                disabled={processingId !== null || !rejectionReason.trim()}
              >
                {processingId === rejectingLeave.id ? 'Rejecting...' : 'Confirm rejection'}
              </button>
              <button
                type="button"
                className="leave-action-btn leave-cancel-btn"
                disabled={processingId !== null}
                onClick={() => {
                  setRejectingLeave(null);
                  setRejectionReason('');
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* TABLE */}
        <div className="leaves-table-wrapper">
          <table className="leaves-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>From</th>
                <th>To</th>
                <th>Days</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8">
                    <div className="leaves-loading">
                      <div className="leaves-loading-spinner" />
                      Loading leave requests...
                    </div>
                  </td>
                </tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan="8">
                    <div className="leaves-empty">
                      <div className="leaves-empty-icon">
                        <FiCalendar size={23} />
                      </div>

                      <div className="leaves-empty-title">
                        No{' '}
                        {tab === 'all'
                          ? ''
                          : tab}{' '}
                        leave requests
                      </div>

                      <div className="leaves-empty-text">
                        There are no leave requests in this category.
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                shown.map((leave) => (
                  <tr key={leave.id}>
                    {/* EMPLOYEE */}
                    <td data-label="Employee">
                      <div className="leave-employee">
                        <div className="leave-avatar">
                          <FiUsers size={16} />
                        </div>

                        <div className="leave-employee-info">
                          <div
                            className="leave-employee-name"
                            title={leave.name || ''}
                          >
                            {leave.name || '-'}
                          </div>

                          {leave.emp_code && (
                            <div className="leave-employee-code">
                              {leave.emp_code}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* TYPE */}
                    <td data-label="Type">
                      <span className="leave-type">
                        {capitalize(leave.leave_type)}
                      </span>
                    </td>

                    {/* FROM */}
                    <td data-label="From">
                      <span className="leave-date">
                        {formatDate(leave.start_date)}
                      </span>
                    </td>

                    {/* TO */}
                    <td data-label="To">
                      <span className="leave-date">
                        {formatDate(leave.end_date)}
                      </span>
                    </td>

                    {/* DAYS */}
                    <td data-label="Days">
                      <span className="leave-days">
                        {days(leave)}
                      </span>
                    </td>

                    {/* REASON */}
                    <td data-label="Reason">
                      <div
                        className="leave-reason"
                        title={leave.reason || ''}
                      >
                        {leave.reason || '-'}
                      </div>
                      <LeaveDocuments leave={leave} />
                      {leave.status === 'rejected' && leave.rejection_reason && (
                        <div className="leave-rejection-reason">
                          <strong>Rejection reason: </strong>{leave.rejection_reason}
                        </div>
                      )}
                    </td>

                    {/* STATUS */}
                    <td data-label="Status">
                      <span
                        className={`leave-status ${
                          leave.status
                        }`}
                      >
                        {leave.status === 'pending' && (
                          <FiClock size={12} />
                        )}

                        {leave.status === 'approved' && (
                          <FiCheckCircle size={12} />
                        )}

                        {leave.status === 'rejected' && (
                          <FiXCircle size={12} />
                        )}

                        {capitalize(leave.status)}
                      </span>
                      {leave.status === 'pending' && (
                        <div style={{ fontSize: 12, color: leave.escalated ? '#b42346' : '#64748b', marginTop: 4 }}>
                          {leave.manager_name ? `With ${leave.manager_name}` : 'No manager'}
                          {leave.waiting_days > 0 && ` · waiting ${leave.waiting_days}d`}
                          {leave.escalated && ' · escalated'}
                        </div>
                      )}
                    </td>

                    {/* ACTION */}
                    <td data-label="Action">
                      {leave.status === 'pending' ? (
                        <div className="leave-actions">
                          <button
                            type="button"
                            className="leave-action-btn leave-approve-btn"
                            onClick={() =>
                              decide(
                                leave.id,
                                'approved'
                              )
                            }
                            disabled={
                              processingId !== null || rejectingLeave !== null
                            }
                            title="Approve leave request"
                          >
                            {processingId === leave.id ? (
                              <FiRefreshCw
                                size={13}
                                className="leaves-refresh-spin"
                              />
                            ) : (
                              <FiCheck size={14} />
                            )}

                            Approve
                          </button>

                          <button
                            type="button"
                            className="leave-action-btn leave-reject-btn"
                            onClick={() => {
                              setRejectingLeave(leave);
                              setRejectionReason('');
                              setError('');
                              setSuccess('');
                            }}
                            disabled={
                              processingId !== null || rejectingLeave !== null
                            }
                            title="Reject leave request"
                          >
                            <FiX size={14} />

                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="leave-processed">
                          Processed
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
