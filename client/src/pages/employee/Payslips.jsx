import { useEffect, useMemo, useState } from 'react';
import api, { downloadPayslip } from '../../api';
import { loanDeductionItems } from '../../utils/payrollDeductions';

import {
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiDownload,
  FiFileText,
  FiRefreshCw,
  FiSearch,
  FiTrendingUp,
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

const money = (n) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);

// Build YYYY-MM from a Date using local time.
const toKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Build YYYY-MM from a payslip row.
const slipKey = (p) =>
  `${p.year}-${String(p.month).padStart(2, '0')}`;

const labelFromKey = (key) => {
  if (!key) return 'All periods';

  const [y, m] = key.split('-');

  return `${MONTHS[Number(m) - 1] || m} ${y}`;
};

const getPeriodLabel = (p) =>
  `${MONTHS[Number(p.month) - 1] || p.month} ${p.year}`;

const lossOfPayLabel = (p) => {
  const days = p.unpaid_leave_days ?? p.calculation_snapshot?.unpaid_dates?.length;
  return days == null ? 'Loss Of Pay' : `Loss Of Pay (${days} ${Number(days) === 1 ? 'day' : 'days'})`;
};

// Everything earned beyond basic pay. The `allowances` column is only the one-off additional
// amount, so the salary components (HRA, special, LTA, other) must be added or net pay does not reconcile.
const getAllowances = (p) => (
  Number(p.hra || 0) +
  Number(p.special_allowance || 0) +
  Number(p.lta || 0) +
  Number(p.other_allowances || 0) +
  Number(p.allowances || 0) +
  Number(p.travel_allowance || 0) +
  Number(p.leave_allowance || 0) +
  Number(p.bonus || 0)
);

const cap = (value) => String(value).charAt(0).toUpperCase() + String(value).slice(1);

const getDeductions = (p) => {
  return (
    Number(p.professional_tax || 0) +
    Number(p.epf || 0) + Number(p.deductions || 0)
  );
};

export default function Payslips() {
  const now = new Date();
  const lastMonth = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1
  );

  const currentMonthKey = toKey(now);
  const lastMonthKey = toKey(lastMonth);

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState(lastMonthKey);
  const [downloadingId, setDownloadingId] = useState(null);
  const [downloadError, setDownloadError] = useState('');

  const load = async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError('');

      const r = await api.get('/payslips/my');

      setList(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      setError(
        e?.response?.data?.message ||
          'Failed to load payslips.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();

    const id = setInterval(() => {
      load(true);
    }, 60000);

    return () => clearInterval(id);
  }, []);

  const rows = useMemo(
    () =>
      list
        .filter(
          (p) =>
            !period ||
            slipKey(p) === period
        )
        .sort(
          (a, b) =>
            Number(b.year) - Number(a.year) ||
            Number(b.month) - Number(a.month)
        ),
    [list, period]
  );

  const totalPayslips = list.length;

  const totalNetPay = list.reduce(
    (sum, p) => sum + Number(p.net_pay || 0),
    0
  );

  const latestPayslip = [...list].sort(
    (a, b) =>
      Number(b.year) - Number(a.year) ||
      Number(b.month) - Number(a.month)
  )[0];

  const handleDownload = async (id) => {
    if (!id || downloadingId) return;

    try {
      setDownloadError('');
      setDownloadingId(id);

      await downloadPayslip(id);
    } catch (e) {
      setDownloadError(
        e?.response?.data?.message ||
          'Could not download payslip. Please try again.'
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const clearFilter = () => {
    setPeriod('');
  };

  return (
    <div className="employee-payslips">
      <style>{`
        .employee-payslips {
          width: 100%;
          max-width: 1400px;
          margin: 0 auto;
          padding-bottom: 32px;
          color: #0f172a;
        }

        .payslip-page-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 24px;
        }

        .payslip-title-wrap {
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }

        .payslip-title-icon {
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

        .payslip-title-icon svg {
          width: 23px;
          height: 23px;
        }

        .payslip-page-head h1 {
          margin: 0;
          font-size: 28px;
          line-height: 1.2;
          font-weight: 750;
          letter-spacing: -0.4px;
        }

        .payslip-page-head p {
          margin: 7px 0 0;
          color: #64748b;
          font-size: 14px;
          line-height: 1.5;
        }

        .refresh-btn {
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

        .refresh-btn:hover {
          border-color: #a5b4fc;
          background: #f8fbff;
          color: #4f46e5;
        }

        .refresh-btn:disabled {
          opacity: .65;
          cursor: not-allowed;
        }

        .refresh-btn svg {
          width: 16px;
          height: 16px;
        }

        .spin {
          animation: payslipSpin .8s linear infinite;
        }

        @keyframes payslipSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .payslip-summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 22px;
        }

        .summary-card {
          position: relative;
          overflow: hidden;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 18px;
          box-shadow: 0 5px 18px rgba(15, 23, 42, .045);
        }

        .summary-card::after {
          content: "";
          position: absolute;
          right: -28px;
          bottom: -32px;
          width: 95px;
          height: 95px;
          border-radius: 50%;
          background: #f8fafc;
          pointer-events: none;
        }

        .summary-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .summary-icon {
          width: 40px;
          height: 40px;
          border-radius: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .summary-icon svg {
          width: 19px;
          height: 19px;
        }

        .summary-icon.blue {
          background: #eef2ff;
          color: #4f46e5;
        }

        .summary-icon.green {
          background: #ecfdf5;
          color: #059669;
        }

        .summary-icon.purple {
          background: #f5f3ff;
          color: #7c3aed;
        }

        .summary-label {
          margin-top: 13px;
          color: #64748b;
          font-size: 12px;
          font-weight: 600;
        }

        .summary-value {
          margin-top: 4px;
          color: #0f172a;
          font-size: 21px;
          font-weight: 750;
          letter-spacing: -.25px;
        }

        .summary-sub {
          margin-top: 4px;
          color: #94a3b8;
          font-size: 11px;
        }

        .filter-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 18px;
          margin-bottom: 18px;
          box-shadow: 0 5px 18px rgba(15, 23, 42, .035);
        }

        .filter-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 15px;
        }

        .filter-header-icon {
          width: 34px;
          height: 34px;
          border-radius: 9px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f1f5f9;
          color: #475569;
        }

        .filter-header-icon svg {
          width: 17px;
          height: 17px;
        }

        .filter-header strong {
          font-size: 14px;
          color: #1e293b;
        }

        .filter-header span {
          margin-left: 3px;
          color: #94a3b8;
          font-size: 12px;
        }

        .filter-content {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 18px;
        }

        .month-field {
          min-width: 230px;
        }

        .month-field label {
          display: block;
          margin-bottom: 7px;
          color: #475569;
          font-size: 12px;
          font-weight: 650;
        }

        .month-input-wrap {
          position: relative;
        }

        .month-input-wrap svg {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: #64748b;
          width: 16px;
          height: 16px;
          pointer-events: none;
        }

        .month-input {
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
          transition: border-color .2s ease, box-shadow .2s ease;
        }

        .month-input:focus {
          border-color: #818cf8;
          box-shadow: 0 0 0 3px rgba(79, 70, 229, .10);
        }

        .filter-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .filter-btn {
          min-height: 40px;
          padding: 0 13px;
          border: 1px solid #dbe3ef;
          border-radius: 9px;
          background: #fff;
          color: #475569;
          font-size: 12px;
          font-weight: 650;
          cursor: pointer;
          transition: all .2s ease;
        }

        .filter-btn:hover {
          border-color: #a5b4fc;
          color: #4f46e5;
          background: #f8fbff;
        }

        .filter-btn.active {
          border-color: #4f46e5;
          background: #4f46e5;
          color: #fff;
        }

        .clear-filter {
          min-height: 40px;
          padding: 0 12px;
          border: 0;
          background: transparent;
          color: #64748b;
          font-size: 12px;
          font-weight: 650;
          cursor: pointer;
        }

        .clear-filter:hover {
          color: #4f46e5;
        }

        .payslips-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 5px 18px rgba(15, 23, 42, .035);
        }

        .card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 18px 20px;
          border-bottom: 1px solid #eef2f7;
        }

        .card-header-left {
          display: flex;
          align-items: center;
          gap: 11px;
        }

        .card-header-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #eef2ff;
          color: #4f46e5;
        }

        .card-header-icon svg {
          width: 18px;
          height: 18px;
        }

        .card-header h2 {
          margin: 0;
          color: #1e293b;
          font-size: 15px;
          font-weight: 720;
        }

        .card-header p {
          margin: 3px 0 0;
          color: #94a3b8;
          font-size: 11px;
        }

        .result-count {
          padding: 5px 9px;
          border-radius: 999px;
          background: #f1f5f9;
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
        }

        .table-wrap {
          width: 100%;
          overflow-x: auto;
        }

        .payslip-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 760px;
        }

        .payslip-table th {
          padding: 12px 18px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .35px;
          text-align: left;
          white-space: nowrap;
        }

        .payslip-table th.right,
        .payslip-table td.right {
          text-align: right;
        }

        .payslip-table td {
          padding: 16px 18px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
          font-size: 13px;
          vertical-align: middle;
          white-space: nowrap;
        }

        .payslip-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .payslip-table tbody tr {
          transition: background .15s ease;
        }

        .payslip-table tbody tr:hover {
          background: #fafcff;
        }

        .period-cell {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .period-icon {
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

        .period-icon svg {
          width: 16px;
          height: 16px;
        }

        .period-name {
          display: block;
          color: #1e293b;
          font-size: 13px;
          font-weight: 700;
        }

        .period-label {
          display: block;
          margin-top: 2px;
          color: #94a3b8;
          font-size: 10px;
        }

        .positive {
          color: #059669 !important;
          font-weight: 600;
        }

        .negative {
          color: #dc2626 !important;
          font-weight: 600;
        }

        .net-pay {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 9px;
          border-radius: 8px;
          background: #ecfdf5;
          color: #047857;
          font-size: 12px;
          font-weight: 750;
        }

        .net-pay svg {
          width: 13px;
          height: 13px;
        }

        .download-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 36px;
          padding: 0 12px;
          border: 1px solid #dbe3ef;
          border-radius: 9px;
          background: #fff;
          color: #334155;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all .2s ease;
        }

        .download-btn:hover {
          border-color: #4f46e5;
          background: #eef2ff;
          color: #4f46e5;
        }

        .download-btn:disabled {
          opacity: .6;
          cursor: not-allowed;
        }

        .download-btn svg {
          width: 15px;
          height: 15px;
        }

        .download-error {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 14px 18px 0;
          padding: 10px 12px;
          border-radius: 9px;
          background: #fef2f2;
          color: #b91c1c;
          font-size: 12px;
        }

        .download-error svg {
          width: 15px;
          height: 15px;
          flex-shrink: 0;
        }

        .state-box {
          min-height: 260px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 30px 20px;
        }

        .state-icon {
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

        .state-icon svg {
          width: 23px;
          height: 23px;
        }

        .state-icon.error {
          background: #fef2f2;
          color: #dc2626;
        }

        .state-icon.success {
          background: #ecfdf5;
          color: #059669;
        }

        .state-title {
          margin: 0;
          color: #1e293b;
          font-size: 15px;
          font-weight: 720;
        }

        .state-text {
          max-width: 430px;
          margin: 6px auto 0;
          color: #94a3b8;
          font-size: 12px;
          line-height: 1.6;
        }

        .retry-btn {
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

        .retry-btn:hover {
          background: #4338ca;
        }

        .retry-btn svg {
          width: 14px;
          height: 14px;
        }

        .loading-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          min-height: 260px;
          color: #64748b;
          font-size: 13px;
        }

        .loading-spinner {
          width: 18px;
          height: 18px;
          border: 2px solid #e0e7ff;
          border-top-color: #4f46e5;
          border-radius: 50%;
          animation: payslipSpin .8s linear infinite;
        }

        .mobile-list {
          display: none;
        }

        .mobile-payslip {
          padding: 16px;
          border-bottom: 1px solid #eef2f7;
        }

        .mobile-payslip:last-child {
          border-bottom: 0;
        }

        .mobile-payslip-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .mobile-period {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .mobile-period h3 {
          margin: 0;
          font-size: 14px;
          color: #1e293b;
        }

        .mobile-period small {
          display: block;
          margin-top: 3px;
          color: #94a3b8;
          font-size: 10px;
        }

        .mobile-net {
          text-align: right;
        }

        .mobile-net small {
          display: block;
          color: #94a3b8;
          font-size: 10px;
          margin-bottom: 3px;
        }

        .mobile-net strong {
          color: #047857;
          font-size: 14px;
        }

        .mobile-breakdown {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          margin: 15px 0;
        }

        .mobile-breakdown-item {
          padding: 10px;
          border-radius: 9px;
          background: #f8fafc;
        }

        .mobile-breakdown-item span {
          display: block;
          color: #94a3b8;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: .25px;
          font-weight: 700;
        }

        .mobile-breakdown-item strong {
          display: block;
          margin-top: 4px;
          font-size: 11px;
          color: #334155;
        }

        .mobile-breakdown-item strong.positive {
          color: #059669;
        }

        .mobile-breakdown-item strong.negative {
          color: #dc2626;
        }

        .mobile-download {
          width: 100%;
        }

        @media (max-width: 900px) {
          .payslip-summary {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .filter-content {
            align-items: stretch;
            flex-direction: column;
          }

          .month-field {
            width: 100%;
            max-width: 320px;
          }
        }

        @media (max-width: 700px) {
          .employee-payslips {
            padding-bottom: 20px;
          }

          .payslip-page-head {
            align-items: stretch;
            flex-direction: column;
            margin-bottom: 18px;
          }

          .payslip-page-head h1 {
            font-size: 23px;
          }

          .payslip-title-icon {
            width: 42px;
            height: 42px;
            border-radius: 12px;
          }

          .refresh-btn {
            width: 100%;
          }

          .payslip-summary {
            grid-template-columns: 1fr 1fr;
            gap: 10px;
          }

          .summary-card {
            padding: 14px;
            border-radius: 13px;
          }

          .summary-icon {
            width: 35px;
            height: 35px;
          }

          .summary-value {
            font-size: 17px;
          }

          .filter-card {
            padding: 14px;
            border-radius: 13px;
          }

          .month-field {
            max-width: none;
          }

          .filter-actions {
            width: 100%;
          }

          .filter-btn {
            flex: 1;
            min-width: 0;
            padding: 0 8px;
          }

          .clear-filter {
            width: 100%;
          }

          .card-header {
            padding: 14px;
          }

          .payslip-table-wrap {
            display: none;
          }

          .mobile-list {
            display: block;
          }
        }

        @media (max-width: 430px) {
          .payslip-summary {
            grid-template-columns: 1fr;
          }

          .summary-card {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .summary-label {
            margin-top: 0;
          }

          .summary-value {
            margin-top: 2px;
          }

          .summary-sub {
            display: none;
          }

          .summary-content {
            min-width: 0;
          }

          .filter-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }

          .filter-btn:last-of-type {
            grid-column: 1 / -1;
          }

          .mobile-breakdown {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {/* Page Header */}
      <div className="payslip-page-head">
        <div className="payslip-title-wrap">
          <div className="payslip-title-icon">
            <FiFileText />
          </div>

          <div>
            <h1>My Payslips</h1>
            <p>
              View your salary statements and download
              official payment receipts.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="refresh-btn"
          onClick={() => load(true)}
          disabled={loading || refreshing}
        >
          <FiRefreshCw
            className={refreshing ? 'spin' : ''}
          />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Summary */}
      <div className="payslip-summary">
        <div className="summary-card">
          <div className="summary-top">
            <div className="summary-icon blue">
              <FiFileText />
            </div>
          </div>

          <div className="summary-content">
            <div className="summary-label">
              Total Payslips
            </div>
            <div className="summary-value">
              {totalPayslips}
            </div>
            <div className="summary-sub">
              Available salary statements
            </div>
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-top">
            <div className="summary-icon green">
              <FiTrendingUp />
            </div>
          </div>

          <div className="summary-content">
            <div className="summary-label">
              Total Net Pay
            </div>
            <div className="summary-value">
              {money(totalNetPay)}
            </div>
            <div className="summary-sub">
              Across available payslips
            </div>
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-top">
            <div className="summary-icon purple">
              <FiCalendar />
            </div>
          </div>

          <div className="summary-content">
            <div className="summary-label">
              Latest Payslip
            </div>
            <div className="summary-value">
              {latestPayslip
                ? getPeriodLabel(latestPayslip)
                : '-'}
            </div>
            <div className="summary-sub">
              Most recently generated
            </div>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="filter-card">
        <div className="filter-header">
          <div className="filter-header-icon">
            <FiSearch />
          </div>

          <div>
            <strong style={{ display: 'block' }}>Filter Payslips</strong>
            <span style={{ display: 'block', marginTop: 2, fontSize: 13, color: '#64748b' }}>
              Choose a salary period to view
            </span>
          </div>
        </div>

        <div className="filter-content">
          <div className="month-field">
            <label htmlFor="month-picker">
              Salary Month
            </label>

            <div className="month-input-wrap">
              <FiCalendar />

              <input
                id="month-picker"
                className="month-input"
                type="month"
                value={period}
                max={currentMonthKey}
                onChange={(e) =>
                  setPeriod(e.target.value)
                }
              />
            </div>
          </div>

          <div className="filter-actions">
            <button
              type="button"
              className={`filter-btn ${
                period === currentMonthKey
                  ? 'active'
                  : ''
              }`}
              onClick={() =>
                setPeriod(currentMonthKey)
              }
            >
              This Month
            </button>

            <button
              type="button"
              className={`filter-btn ${
                period === lastMonthKey
                  ? 'active'
                  : ''
              }`}
              onClick={() =>
                setPeriod(lastMonthKey)
              }
            >
              Last Month
            </button>

            <button
              type="button"
              className={`filter-btn ${
                period === '' ? 'active' : ''
              }`}
              onClick={clearFilter}
            >
              Show All
            </button>

            {period && (
              <button
                type="button"
                className="clear-filter"
                onClick={clearFilter}
              >
                Clear filter
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Payslip List */}
      <div className="payslips-card">
        <div className="card-header">
          <div className="card-header-left">
            <div className="card-header-icon">
              <FiFileText />
            </div>

            <div>
              <h2>Salary Statements</h2>
              <p>
                {period
                  ? labelFromKey(period)
                  : 'All available periods'}
              </p>
            </div>
          </div>

          {!loading && !error && (
            <span className="result-count">
              {rows.length}{' '}
              {rows.length === 1
                ? 'payslip'
                : 'payslips'}
            </span>
          )}
        </div>

        {downloadError && (
          <div className="download-error">
            <FiXCircle />
            <span>{downloadError}</span>
          </div>
        )}

        {loading ? (
          <div className="loading-row">
            <span className="loading-spinner" />
            Loading your payslips...
          </div>
        ) : error ? (
          <div className="state-box">
            <div className="state-icon error">
              <FiXCircle />
            </div>

            <h3 className="state-title">
              Unable to load payslips
            </h3>

            <p className="state-text">
              {error}
            </p>

            <button
              type="button"
              className="retry-btn"
              onClick={() => load(true)}
              disabled={refreshing}
            >
              <FiRefreshCw
                className={
                  refreshing ? 'spin' : ''
                }
              />
              Try Again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="state-box">
            <div className="state-icon">
              <FiFileText />
            </div>

            <h3 className="state-title">
              {period
                ? `No payslip for ${labelFromKey(period)}`
                : 'No payslips available yet'}
            </h3>

            <p className="state-text">
              {period
                ? 'Try selecting another month or choose "Show All" to view your available payslips.'
                : 'Your payslips will appear here once they are generated by HR.'}
            </p>

            {period && (
              <button
                type="button"
                className="retry-btn"
                onClick={clearFilter}
              >
                <FiSearch />
                Show All Payslips
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop / Tablet Table */}
            <div className="table-wrap payslip-table-wrap">
              <table className="payslip-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Basic Pay</th>
                    <th>Allowances</th>
                    <th>Deductions</th>
                    <th>Net Pay</th>
                    <th className="right">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((p) => {
                    const allowances =
                      getAllowances(p);
                    const deductions =
                      getDeductions(p);
                    const totalDeductions =
                      deductions + Number(p.advance || 0);

                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="period-cell">
                            <div className="period-icon">
                              <FiCalendar />
                            </div>

                            <div>
                              <span className="period-name">
                                {getPeriodLabel(p)}
                              </span>

                              <span className="period-label">
                                {cap(p.status || 'generated')} · {cap(p.payment_status || 'not recorded')}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td>
                          {money(p.basic)}
                        </td>

                        <td className={allowances > 0 ? 'positive' : 'muted-zero'}>
                          {allowances > 0 ? '+' : ''}{money(allowances)}
                        </td>

                        <td className={totalDeductions > 0 ? 'negative' : 'muted-zero'}>
                          {totalDeductions > 0 ? '-' : ''}{money(totalDeductions)}
                          <details><summary>Deduction breakdown</summary><small style={{ display: 'block' }}>EPF: {money(p.epf)}</small><small style={{ display: 'block' }}>Professional tax: {money(p.professional_tax)}</small>{Number(p.late_login_deduction) > 0 && <small style={{ display: 'block' }}>Late login (half day): {money(p.late_login_deduction)} — {p.late_login_reason}</small>}{p.unpaid_leave_deduction == null ? <small>Other / Loss Of Pay: {money(p.deductions)}</small> : <><small style={{ display: 'block' }}>{lossOfPayLabel(p)}: {money(p.unpaid_leave_deduction)}</small><small style={{ display: 'block' }}>Additional deductions: {money(p.additional_deductions)}</small></>}</details>
                          {loanDeductionItems(p).map((entry) => (
                            <small key={entry.id} style={{ display: 'block' }}>
                              {entry.label}: -{money(entry.amount)}
                            </small>
                          ))}
                        </td>

                        <td>
                          <span className="net-pay">
                            <FiCheckCircle />
                            {money(p.net_pay)}
                          </span>
                        </td>

                        <td className="right">
                          <button
                            type="button"
                            className="download-btn"
                            onClick={() =>
                              handleDownload(p.id)
                            }
                            disabled={
                              downloadingId === p.id
                            }
                          >
                            {downloadingId === p.id ? (
                              <>
                                <FiClock />
                                Downloading...
                              </>
                            ) : (
                              <>
                                <FiDownload />
                                Download PDF
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="mobile-list">
              {rows.map((p) => {
                const allowances =
                  getAllowances(p);
                const deductions =
                  getDeductions(p);

                return (
                  <div
                    className="mobile-payslip"
                    key={p.id}
                  >
                    <div className="mobile-payslip-top">
                      <div className="mobile-period">
                        <div className="period-icon">
                          <FiCalendar />
                        </div>

                        <div>
                          <h3>
                            {getPeriodLabel(p)}
                          </h3>
                          <small>
                            {cap(p.status || 'generated')} · {cap(p.payment_status || 'not recorded')}
                          </small>
                        </div>
                      </div>

                      <div className="mobile-net">
                        <small>Net Pay</small>
                        <strong>
                          {money(p.net_pay)}
                        </strong>
                      </div>
                    </div>

                    <div className="mobile-breakdown">
                      <div className="mobile-breakdown-item">
                        <span>Basic</span>
                        <strong>
                          {money(p.basic)}
                        </strong>
                      </div>

                      <div className="mobile-breakdown-item">
                        <span>Allowances</span>
                        <strong className="positive">
                          +{money(allowances)}
                        </strong>
                      </div>

                      <div className="mobile-breakdown-item">
                        <span>Deductions</span>
                        <strong className="negative">
                          -{money(deductions + Number(p.advance || 0))}
                        </strong>
                      </div>

                      {loanDeductionItems(p).map((entry) => (
                        <div className="mobile-breakdown-item" key={entry.id}>
                          <span>{entry.label}</span>
                          <strong className="negative">
                            -{money(entry.amount)}
                          </strong>
                        </div>
                      ))}
                      <div className="mobile-breakdown-item"><span>EPF</span><strong>{money(p.epf)}</strong></div>
                      <div className="mobile-breakdown-item"><span>Professional tax</span><strong>{money(p.professional_tax)}</strong></div>
                      {Number(p.late_login_deduction) > 0 && <><div className="mobile-breakdown-item"><span>Late login (half day)</span><strong>{money(p.late_login_deduction)}</strong></div><small>{p.late_login_reason}</small></>}
                      {p.unpaid_leave_deduction != null && <><div className="mobile-breakdown-item"><span>{lossOfPayLabel(p)}</span><strong>{money(p.unpaid_leave_deduction)}</strong></div><div className="mobile-breakdown-item"><span>Additional deductions</span><strong>{money(p.additional_deductions)}</strong></div></>}
                    </div>

                    <button
                      type="button"
                      className="download-btn mobile-download"
                      onClick={() =>
                        handleDownload(p.id)
                      }
                      disabled={
                        downloadingId === p.id
                      }
                    >
                      {downloadingId === p.id ? (
                        <>
                          <FiClock />
                          Downloading PDF...
                        </>
                      ) : (
                        <>
                          <FiDownload />
                          Download Payslip PDF
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
