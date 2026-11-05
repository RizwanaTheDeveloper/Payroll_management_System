import AttendanceRequests from '../../components/AttendanceRequests';
import { useEffect, useMemo, useState } from 'react';
import api from '../../api';
import CheckInCard from '../../components/CheckInCard';

import {
  FiActivity,
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiLogIn,
  FiLogOut,
  FiRefreshCw,
  FiSearch,
  FiXCircle,
} from 'react-icons/fi';

const fmtTime = (v) =>
  v
    ? new Date(v).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-';

const fmtDate = (v) =>
  v
    ? new Date(v).toLocaleDateString('en-IN', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '-';

const monthKey = (v) =>
  v ? String(v).slice(0, 7) : '';

const statusLabel = (status, dayType) => {
  const value = String(status || '').toLowerCase();

  if (value === 'present') return dayType === 'half' ? 'Half Day' : 'Full Day';
  if (value === 'paid_leave') return 'Paid Leave';
  if (value === 'absent') return 'Unpaid Leave';
  if (value === 'leave') return 'On Leave';

  return status || 'Unknown';
};

const statusClass = (status) => {
  const value = String(status || '').toLowerCase();

  if (value === 'present') return 'present';
  if (value === 'absent') return 'absent';
  if (value === 'leave' || value === 'paid_leave') return 'leave';

  return 'unknown';
};

const getStatusIcon = (status) => {
  const value = String(status || '').toLowerCase();

  if (value === 'present') return FiCheckCircle;
  if (value === 'absent') return FiXCircle;
  if (value === 'leave' || value === 'paid_leave') return FiCalendar;

  return FiActivity;
};

const getWorkingHours = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) {
    return '-';
  }

  const start = new Date(checkIn);
  const end = new Date(checkOut);

  const diff = end - start;

  if (Number.isNaN(diff) || diff <= 0) {
    return '-';
  }

  const totalMinutes = Math.floor(diff / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
};

export default function Attendance() {
  const currentMonth = new Date()
    .toISOString()
    .slice(0, 7);

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [month, setMonth] = useState(currentMonth);

  const load = async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError('');

      const r = await api.get('/attendance/my');

      setList(
        Array.isArray(r.data)
          ? r.data
          : []
      );
    } catch (e) {
      setError(
        e?.response?.data?.message ||
          'Failed to load attendance.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();

    // Refresh every 60 seconds so admin updates
    // appear without manually reloading the page.
    const id = setInterval(() => {
      load(true);
    }, 60000);

    return () => clearInterval(id);
  }, []);

  const rows = useMemo(
    () =>
      list
        .filter(
          (a) =>
            !month ||
            monthKey(a.work_date) === month
        )
        .sort((a, b) =>
          String(b.work_date).localeCompare(
            String(a.work_date)
          )
        ),
    [list, month]
  );

  const presentCount = rows.filter(
    (a) =>
      String(a.status || '').toLowerCase() ===
      'present'
  ).length;

  const absentCount = rows.filter(
    (a) =>
      String(a.status || '').toLowerCase() ===
      'absent'
  ).length;

  const leaveCount = rows.filter(
    (a) =>
      ['leave', 'paid_leave'].includes(String(a.status || '').toLowerCase())
  ).length;

  const attendancePercentage =
    rows.length > 0
      ? Math.round(
          (presentCount / rows.length) * 100
        )
      : 0;

  const selectedPeriod = month
    ? new Date(`${month}-01`).toLocaleDateString(
        'en-IN',
        {
          month: 'long',
          year: 'numeric',
        }
      )
    : 'All periods';

  return (
    <div className="employee-attendance-page">
      <style>{`
        .employee-attendance-page {
          width: 100%;
          max-width: 1400px;
          margin: 0 auto;
          padding-bottom: 32px;
          color: #0f172a;
        }

        .attendance-page-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 24px;
        }

        .attendance-title-wrap {
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }

        .attendance-title-icon {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #eef2ff;
          color: #4f46e5;
          flex-shrink: 0;
        }

        .attendance-title-icon svg {
          width: 23px;
          height: 23px;
        }

        .attendance-page-head h1 {
          margin: 0;
          font-size: 28px;
          line-height: 1.2;
          font-weight: 750;
          letter-spacing: -.4px;
        }

        .attendance-page-head p {
          margin: 7px 0 0;
          color: #64748b;
          font-size: 14px;
          line-height: 1.5;
        }

        .attendance-refresh-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 40px;
          padding: 0 14px;
          border: 1px solid #dbe3ef;
          border-radius: 10px;
          background: #fff;
          color: #334155;
          font-size: 13px;
          font-weight: 650;
          cursor: pointer;
          transition: all .2s ease;
        }

        .attendance-refresh-btn:hover {
          border-color: #a5b4fc;
          background: #f8fbff;
          color: #4f46e5;
        }

        .attendance-refresh-btn:disabled {
          opacity: .65;
          cursor: not-allowed;
        }

        .attendance-refresh-btn svg {
          width: 16px;
          height: 16px;
        }

        .attendance-spin {
          animation: attendanceSpin .8s linear infinite;
        }

        @keyframes attendanceSpin {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }

        .attendance-summary {
          display: grid;
          grid-template-columns:
            repeat(4, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 22px;
        }

        .attendance-summary-card {
          position: relative;
          overflow: hidden;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 18px;
          box-shadow:
            0 5px 18px
            rgba(15, 23, 42, .045);
        }

        .attendance-summary-card::after {
          content: "";
          position: absolute;
          right: -30px;
          bottom: -35px;
          width: 100px;
          height: 100px;
          border-radius: 50%;
          background: #f8fafc;
          pointer-events: none;
        }

        .attendance-summary-icon {
          width: 40px;
          height: 40px;
          border-radius: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .attendance-summary-icon svg {
          width: 19px;
          height: 19px;
        }

        .attendance-summary-icon.blue {
          background: #eef2ff;
          color: #4f46e5;
        }

        .attendance-summary-icon.green {
          background: #ecfdf5;
          color: #059669;
        }

        .attendance-summary-icon.red {
          background: #fef2f2;
          color: #dc2626;
        }

        .attendance-summary-icon.orange {
          background: #fff7ed;
          color: #ea580c;
        }

        .attendance-summary-label {
          margin-top: 13px;
          color: #64748b;
          font-size: 12px;
          font-weight: 600;
        }

        .attendance-summary-value {
          margin-top: 4px;
          color: #0f172a;
          font-size: 22px;
          font-weight: 750;
          letter-spacing: -.3px;
        }

        .attendance-summary-sub {
          margin-top: 4px;
          color: #94a3b8;
          font-size: 11px;
        }

        .attendance-filter-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 18px;
          margin-bottom: 18px;
          box-shadow:
            0 5px 18px
            rgba(15, 23, 42, .035);
        }

        .attendance-filter-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 15px;
        }

        .attendance-filter-icon {
          width: 34px;
          height: 34px;
          border-radius: 9px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f1f5f9;
          color: #475569;
        }

        .attendance-filter-icon svg {
          width: 17px;
          height: 17px;
        }

        .attendance-filter-title {
          color: #1e293b;
          font-size: 14px;
          font-weight: 720;
        }

        .attendance-filter-description {
          margin-left: 4px;
          color: #94a3b8;
          font-size: 12px;
        }

        .attendance-filter-content {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 18px;
        }

        .attendance-month-field {
          min-width: 230px;
        }

        .attendance-month-field label {
          display: block;
          margin-bottom: 7px;
          color: #475569;
          font-size: 12px;
          font-weight: 650;
        }

        .attendance-month-input-wrap {
          position: relative;
        }

        .attendance-month-input-wrap svg {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: #64748b;
          width: 16px;
          height: 16px;
          pointer-events: none;
        }

        .attendance-month-input {
          width: 100%;
          height: 42px;
          box-sizing: border-box;
          padding: 0 12px 0 38px;
          border: 1px solid #dbe3ef;
          border-radius: 10px;
          background: #fff;
          color: #0f172a;
          font-size: 13px;
          outline: none;
          transition:
            border-color .2s ease,
            box-shadow .2s ease;
        }

        .attendance-month-input:focus {
          border-color: #818cf8;
          box-shadow:
            0 0 0 3px
            rgba(79, 70, 229, .10);
        }

        .attendance-filter-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .attendance-filter-btn {
          min-height: 40px;
          padding: 0 14px;
          border: 1px solid #dbe3ef;
          border-radius: 9px;
          background: #fff;
          color: #475569;
          font-size: 12px;
          font-weight: 650;
          cursor: pointer;
          transition: all .2s ease;
        }

        .attendance-filter-btn:hover {
          border-color: #a5b4fc;
          color: #4f46e5;
          background: #f8fbff;
        }

        .attendance-filter-btn.active {
          border-color: #4f46e5;
          background: #4f46e5;
          color: #fff;
        }

        .attendance-clear-btn {
          min-height: 40px;
          padding: 0 12px;
          border: 0;
          background: transparent;
          color: #64748b;
          font-size: 12px;
          font-weight: 650;
          cursor: pointer;
        }

        .attendance-clear-btn:hover {
          color: #4f46e5;
        }

        .attendance-records-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          overflow: hidden;
          box-shadow:
            0 5px 18px
            rgba(15, 23, 42, .035);
        }

        .attendance-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 18px 20px;
          border-bottom: 1px solid #eef2f7;
        }

        .attendance-card-header-left {
          display: flex;
          align-items: center;
          gap: 11px;
        }

        .attendance-record-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #eef2ff;
          color: #4f46e5;
        }

        .attendance-record-icon svg {
          width: 18px;
          height: 18px;
        }

        .attendance-card-header h2 {
          margin: 0;
          color: #1e293b;
          font-size: 15px;
          font-weight: 720;
        }

        .attendance-card-header p {
          margin: 3px 0 0;
          color: #94a3b8;
          font-size: 11px;
        }

        .attendance-result-count {
          padding: 5px 9px;
          border-radius: 999px;
          background: #f1f5f9;
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
        }

        .attendance-table-wrap {
          width: 100%;
          overflow-x: auto;
        }

        .attendance-table {
          width: 100%;
          min-width: 700px;
          border-collapse: collapse;
        }

        .attendance-table th {
          padding: 12px 18px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
          text-align: left;
          text-transform: uppercase;
          letter-spacing: .35px;
          white-space: nowrap;
        }

        .attendance-table td {
          padding: 15px 18px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
          font-size: 13px;
          vertical-align: middle;
          white-space: nowrap;
        }

        .attendance-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .attendance-table tbody tr {
          transition: background .15s ease;
        }

        .attendance-table tbody tr:hover {
          background: #fafcff;
        }

        .attendance-date-cell {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .attendance-date-icon {
          width: 34px;
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 9px;
          background: #f8fafc;
          color: #475569;
          flex-shrink: 0;
        }

        .attendance-date-icon svg {
          width: 16px;
          height: 16px;
        }

        .attendance-date-main {
          display: block;
          color: #1e293b;
          font-size: 13px;
          font-weight: 700;
        }

        .attendance-date-sub {
          display: block;
          margin-top: 2px;
          color: #94a3b8;
          font-size: 10px;
        }

        .attendance-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
        }

        .attendance-status svg {
          width: 13px;
          height: 13px;
        }

        .attendance-status.present {
          background: #ecfdf5;
          color: #047857;
        }

        .attendance-status.absent {
          background: #fef2f2;
          color: #b91c1c;
        }

        .attendance-status.leave {
          background: #fff7ed;
          color: #c2410c;
        }

        .attendance-status.unknown {
          background: #f1f5f9;
          color: #64748b;
        }

        .attendance-time {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #475569;
          font-weight: 600;
        }

        .attendance-time svg {
          width: 14px;
          height: 14px;
          color: #94a3b8;
        }

        .attendance-hours {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #334155;
          font-weight: 650;
        }

        .attendance-hours svg {
          width: 14px;
          height: 14px;
          color: #64748b;
        }

        .attendance-mobile-list {
          display: none;
        }

        .attendance-mobile-item {
          padding: 16px;
          border-bottom: 1px solid #eef2f7;
        }

        .attendance-mobile-item:last-child {
          border-bottom: 0;
        }

        .attendance-mobile-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .attendance-mobile-date {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .attendance-mobile-date h3 {
          margin: 0;
          color: #1e293b;
          font-size: 14px;
        }

        .attendance-mobile-date small {
          display: block;
          margin-top: 3px;
          color: #94a3b8;
          font-size: 10px;
        }

        .attendance-mobile-times {
          display: grid;
          grid-template-columns:
            repeat(3, minmax(0, 1fr));
          gap: 8px;
          margin-top: 15px;
        }

        .attendance-mobile-time {
          padding: 10px;
          border-radius: 9px;
          background: #f8fafc;
        }

        .attendance-mobile-time span {
          display: flex;
          align-items: center;
          gap: 4px;
          color: #94a3b8;
          font-size: 9px;
          text-transform: uppercase;
          font-weight: 700;
          letter-spacing: .2px;
        }

        .attendance-mobile-time span svg {
          width: 11px;
          height: 11px;
        }

        .attendance-mobile-time strong {
          display: block;
          margin-top: 4px;
          color: #334155;
          font-size: 12px;
        }

        .attendance-state {
          min-height: 260px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 30px 20px;
        }

        .attendance-state-icon {
          width: 54px;
          height: 54px;
          border-radius: 15px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 14px;
          background: #f1f5f9;
          color: #64748b;
        }

        .attendance-state-icon svg {
          width: 23px;
          height: 23px;
        }

        .attendance-state-icon.error {
          background: #fef2f2;
          color: #dc2626;
        }

        .attendance-state h3 {
          margin: 0;
          color: #1e293b;
          font-size: 15px;
          font-weight: 720;
        }

        .attendance-state p {
          max-width: 430px;
          margin: 6px auto 0;
          color: #94a3b8;
          font-size: 12px;
          line-height: 1.6;
        }

        .attendance-retry-btn {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin-top: 15px;
          min-height: 38px;
          padding: 0 13px;
          border: 0;
          border-radius: 9px;
          background: #4f46e5;
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .attendance-retry-btn:hover {
          background: #4338ca;
        }

        .attendance-retry-btn svg {
          width: 14px;
          height: 14px;
        }

        .attendance-loading {
          min-height: 260px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: #64748b;
          font-size: 13px;
        }

        .attendance-spinner {
          width: 18px;
          height: 18px;
          border: 2px solid #e0e7ff;
          border-top-color: #4f46e5;
          border-radius: 50%;
          animation: attendanceSpin .8s linear infinite;
        }

        @media (max-width: 1050px) {
          .attendance-summary {
            grid-template-columns:
              repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 800px) {
          .attendance-filter-content {
            align-items: stretch;
            flex-direction: column;
          }

          .attendance-month-field {
            width: 100%;
            max-width: 320px;
          }
        }

        @media (max-width: 700px) {
          .employee-attendance-page {
            padding-bottom: 20px;
          }

          .attendance-page-head {
            flex-direction: column;
            margin-bottom: 18px;
          }

          .attendance-page-head h1 {
            font-size: 23px;
          }

          .attendance-title-icon {
            width: 42px;
            height: 42px;
            border-radius: 12px;
          }

          .attendance-refresh-btn {
            width: 100%;
          }

          .attendance-summary {
            grid-template-columns: 1fr 1fr;
            gap: 10px;
          }

          .attendance-summary-card {
            padding: 14px;
            border-radius: 13px;
          }

          .attendance-summary-icon {
            width: 35px;
            height: 35px;
          }

          .attendance-summary-value {
            font-size: 18px;
          }

          .attendance-filter-card {
            padding: 14px;
            border-radius: 13px;
          }

          .attendance-month-field {
            max-width: none;
          }

          .attendance-filter-actions {
            width: 100%;
          }

          .attendance-filter-btn {
            flex: 1;
            min-width: 0;
            padding: 0 9px;
          }

          .attendance-clear-btn {
            width: 100%;
          }

          .attendance-card-header {
            padding: 14px;
          }

          .attendance-table-wrap {
            display: none;
          }

          .attendance-mobile-list {
            display: block;
          }
        }

        @media (max-width: 430px) {
          .attendance-summary {
            grid-template-columns: 1fr;
          }

          .attendance-summary-card {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .attendance-summary-label {
            margin-top: 0;
          }

          .attendance-summary-value {
            margin-top: 2px;
          }

          .attendance-summary-sub {
            display: none;
          }

          .attendance-filter-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }

          .attendance-filter-btn:last-of-type {
            grid-column: 1 / -1;
          }

          .attendance-mobile-times {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {/* Page Header */}
      <div className="attendance-page-head">
        <div className="attendance-title-wrap">
          <div className="attendance-title-icon">
            <FiActivity />
          </div>

          <div>
            <h1>My Attendance</h1>
            <p>
              Track your daily attendance,
              check-in and check-out records.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="attendance-refresh-btn"
          onClick={() => load(true)}
          disabled={loading || refreshing}
        >
          <FiRefreshCw
            className={
              refreshing
                ? 'attendance-spin'
                : ''
            }
          />

          {refreshing
            ? 'Refreshing...'
            : 'Refresh'}
        </button>
      </div>

      {/* Summary Cards */}
      <CheckInCard onChange={() => load(true)} />

      <div className="attendance-summary">
        <div className="attendance-summary-card">
          <div className="attendance-summary-icon blue">
            <FiCalendar />
          </div>

          <div>
            <div className="attendance-summary-label">
              Days Recorded
            </div>

            <div className="attendance-summary-value">
              {rows.length}
            </div>

            <div className="attendance-summary-sub">
              {selectedPeriod}
            </div>
          </div>
        </div>

        <div className="attendance-summary-card">
          <div className="attendance-summary-icon green">
            <FiCheckCircle />
          </div>

          <div>
            <div className="attendance-summary-label">
              Present
            </div>

            <div className="attendance-summary-value">
              {presentCount}
            </div>

            <div className="attendance-summary-sub">
              {attendancePercentage}% attendance
            </div>
          </div>
        </div>

        <div className="attendance-summary-card">
          <div className="attendance-summary-icon red">
            <FiXCircle />
          </div>

          <div>
            <div className="attendance-summary-label">
              Unpaid Leave
            </div>

            <div className="attendance-summary-value">
              {absentCount}
            </div>

            <div className="attendance-summary-sub">
              Unpaid leave days
            </div>
          </div>
        </div>

        <div className="attendance-summary-card">
          <div className="attendance-summary-icon orange">
            <FiCalendar />
          </div>

          <div>
            <div className="attendance-summary-label">
              On Leave
            </div>

            <div className="attendance-summary-value">
              {leaveCount}
            </div>

            <div className="attendance-summary-sub">
              Leave marked days
            </div>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="attendance-filter-card">
        <div className="attendance-filter-header">
          <div className="attendance-filter-icon">
            <FiSearch />
          </div>

          <div>
            <span className="attendance-filter-title">
              Filter Attendance
            </span>

            <span className="attendance-filter-description">
              Select a month to view records
            </span>
          </div>
        </div>

        <div className="attendance-filter-content">
          <div className="attendance-month-field">
            <label htmlFor="attendance-month">
              Attendance Month
            </label>

            <div className="attendance-month-input-wrap">
              <FiCalendar />

              <input
                id="attendance-month"
                className="attendance-month-input"
                type="month"
                value={month}
                onChange={(e) =>
                  setMonth(e.target.value)
                }
              />
            </div>
          </div>

          <div className="attendance-filter-actions">
            <button
              type="button"
              className={`attendance-filter-btn ${
                month === currentMonth
                  ? 'active'
                  : ''
              }`}
              onClick={() =>
                setMonth(currentMonth)
              }
            >
              This Month
            </button>

            <button
              type="button"
              className={`attendance-filter-btn ${
                month === ''
                  ? 'active'
                  : ''
              }`}
              onClick={() => setMonth('')}
            >
              Show All
            </button>

            {month && (
              <button
                type="button"
                className="attendance-clear-btn"
                onClick={() => setMonth('')}
              >
                Clear filter
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Attendance Records */}
      <div className="attendance-records-card">
        <div className="attendance-card-header">
          <div className="attendance-card-header-left">
            <div className="attendance-record-icon">
              <FiClock />
            </div>

            <div>
              <h2>Attendance Records</h2>
              <p>{selectedPeriod}</p>
            </div>
          </div>

          {!loading && !error && (
            <span className="attendance-result-count">
              {rows.length}{' '}
              {rows.length === 1
                ? 'record'
                : 'records'}
            </span>
          )}
        </div>

        {loading ? (
          <div className="attendance-loading">
            <span className="attendance-spinner" />
            Loading attendance...
          </div>
        ) : error ? (
          <div className="attendance-state">
            <div className="attendance-state-icon error">
              <FiXCircle />
            </div>

            <h3>
              Unable to load attendance
            </h3>

            <p>{error}</p>

            <button
              type="button"
              className="attendance-retry-btn"
              onClick={() => load(true)}
              disabled={refreshing}
            >
              <FiRefreshCw
                className={
                  refreshing
                    ? 'attendance-spin'
                    : ''
                }
              />
              Try Again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="attendance-state">
            <div className="attendance-state-icon">
              <FiCalendar />
            </div>

            <h3>
              No attendance records
            </h3>

            <p>
              There are no attendance records
              available for {selectedPeriod}.
              Try selecting another month or
              choose "Show All".
            </p>

            {month && (
              <button
                type="button"
                className="attendance-retry-btn"
                onClick={() => setMonth('')}
              >
                <FiSearch />
                Show All Records
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop / Tablet Table */}
            <div className="attendance-table-wrap">
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Check In</th>
                    <th>Check Out</th>
                    <th>Working Hours</th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((a) => {
                    const StatusIcon =
                      getStatusIcon(a.status);

                    return (
                      <tr key={a.id}>
                        <td>
                          <div className="attendance-date-cell">
                            <div className="attendance-date-icon">
                              <FiCalendar />
                            </div>

                            <div>
                              <span className="attendance-date-main">
                                {fmtDate(
                                  a.work_date
                                )}
                              </span>

                              <span className="attendance-date-sub">
                                Attendance record
                              </span>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span
                            className={`attendance-status ${statusClass(
                              a.status
                            )}`}
                          >
                            <StatusIcon />
                            {statusLabel(
                              a.status, a.day_type
                            )}
                          </span>
                        </td>

                        <td>
                          <span className="attendance-time">
                            <FiLogIn />
                            {fmtTime(
                              a.check_in
                            )}
                          </span>
                        </td>

                        <td>
                          <span className="attendance-time">
                            <FiLogOut />
                            {fmtTime(
                              a.check_out
                            )}
                          </span>
                        </td>

                        <td>
                          <span className="attendance-hours">
                            <FiClock />
                            {getWorkingHours(
                              a.check_in,
                              a.check_out
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="attendance-mobile-list">
              {rows.map((a) => {
                const StatusIcon =
                  getStatusIcon(a.status);

                return (
                  <div
                    className="attendance-mobile-item"
                    key={a.id}
                  >
                    <div className="attendance-mobile-top">
                      <div className="attendance-mobile-date">
                        <div className="attendance-date-icon">
                          <FiCalendar />
                        </div>

                        <div>
                          <h3>
                            {fmtDate(
                              a.work_date
                            )}
                          </h3>

                          <small>
                            Attendance record
                          </small>
                        </div>
                      </div>

                      <span
                        className={`attendance-status ${statusClass(
                          a.status
                        )}`}
                      >
                        <StatusIcon />
                        {statusLabel(
                          a.status, a.day_type
                        )}
                      </span>
                    </div>

                    <div className="attendance-mobile-times">
                      <div className="attendance-mobile-time">
                        <span>
                          <FiLogIn />
                          Check In
                        </span>

                        <strong>
                          {fmtTime(
                            a.check_in
                          )}
                        </strong>
                      </div>

                      <div className="attendance-mobile-time">
                        <span>
                          <FiLogOut />
                          Check Out
                        </span>

                        <strong>
                          {fmtTime(
                            a.check_out
                          )}
                        </strong>
                      </div>

                      <div className="attendance-mobile-time">
                        <span>
                          <FiClock />
                          Hours
                        </span>

                        <strong>
                          {getWorkingHours(
                            a.check_in,
                            a.check_out
                          )}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      <AttendanceRequests />
    </div>
  );
}
