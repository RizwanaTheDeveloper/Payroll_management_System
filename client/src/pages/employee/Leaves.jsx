import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api';
import LeaveDocuments from '../../components/LeaveDocuments';

import {
  FiAlertCircle,
  FiCalendar,
  FiCheck,
  FiCheckCircle,
  FiClock,
  FiFileText,
  FiRefreshCw,
  FiSend,
  FiX,
  FiXCircle,
} from 'react-icons/fi';

const TYPES = [
  {
    value: 'casual',
    label: 'Casual',
  },
  {
    value: 'sick',
    label: 'Sick',
  },
  {
    value: 'paid',
    label: 'Paid',
  },
];

const empty = {
  leave_type: 'casual',
  start_date: '',
  end_date: '',
  reason: '',
};

const day = (v) =>
  String(v || '').slice(0, 10);

// Inclusive number of days between
// two YYYY-MM-DD strings.
const daysBetween = (s, e) => {
  if (!s || !e) return 0;

  const [sy, sm, sd] = day(s)
    .split('-')
    .map(Number);

  const [ey, em, ed] = day(e)
    .split('-')
    .map(Number);

  const diff =
    (Date.UTC(
      ey,
      em - 1,
      ed
    ) -
      Date.UTC(
        sy,
        sm - 1,
        sd
      )) /
    86400000;

  return diff >= 0 ? diff + 1 : 0;
};

const fmtDate = (v) => {
  const d = day(v);

  if (!d) return '-';

  const [y, m, dd] = d
    .split('-')
    .map(Number);

  return new Date(
    y,
    m - 1,
    dd
  ).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const getStatusIcon = (status) => {
  const value = String(status || '').toLowerCase();

  if (value === 'approved') return FiCheckCircle;
  if (value === 'rejected') return FiXCircle;
  if (value === 'pending') return FiClock;

  return FiAlertCircle;
};

const getStatusClass = (status) => {
  const value = String(status || '').toLowerCase();

  if (
    value === 'approved' ||
    value === 'rejected' ||
    value === 'pending'
  ) {
    return value;
  }

  return 'unknown';
};

const getStatusLabel = (status) => {
  if (!status) return 'Unknown';

  return String(status)
    .charAt(0)
    .toUpperCase() +
    String(status).slice(1);
};

const getTypeLabel = (type) => {
  const found = TYPES.find(
    (item) => item.value === type
  );

  return found?.label || type || '-';
};

export default function Leaves() {
  const [list, setList] = useState([]);
  const [f, setF] = useState(empty);
  const [medicalDocuments, setMedicalDocuments] = useState([]);
  const fileInput = useRef(null);

  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setErr('');

      const r = await api.get('/leaves/my');

      setList(
        Array.isArray(r.data)
          ? r.data
          : []
      );
    } catch (e) {
      setErr(
        e?.response?.data?.message ||
          'Failed to load leave requests.'
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

  const set = (key) => (e) => {
    setF((current) => ({
      ...current,
      [key]: e.target.value,
    }));

    setErr('');
    setOk('');
  };

  const counts = useMemo(() => {
    const count = (status) =>
      list.filter(
        (l) =>
          String(l.status || '').toLowerCase() ===
          status
      ).length;

    return {
      total: list.length,
      pending: count('pending'),
      approved: count('approved'),
      rejected: count('rejected'),
    };
  }, [list]);

  const requestedDays = daysBetween(
    f.start_date,
    f.end_date
  );

  const validate = () => {
    if (
      !f.start_date ||
      !f.end_date
    ) {
      return 'Please select start and end dates.';
    }

    if (requestedDays === 0) {
      return 'End date cannot be before start date.';
    }

    if (!f.reason.trim()) {
      return 'Please enter a reason for your leave.';
    }

    return '';
  };

  const apply = async () => {
    const validationError = validate();

    if (validationError) {
      setErr(validationError);
      setOk('');
      return;
    }

    try {
      setSubmitting(true);
      setErr('');
      setOk('');

      const body = new FormData();
      Object.entries(f).forEach(([key, value]) => body.append(key, value));
      medicalDocuments.forEach((file) => body.append('medical_documents', file));
      await api.post('/leaves', body);

      setF(empty);
      setMedicalDocuments([]);
      if (fileInput.current) fileInput.current.value = '';

      setOk(
        'Leave request submitted successfully.'
      );

      await load();
    } catch (e) {
      setOk('');

      setErr(
        e?.response?.data?.message ||
          'Failed to submit leave request.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const cancelForm = () => {
    setF(empty);
    setMedicalDocuments([]);
    if (fileInput.current) fileInput.current.value = '';
    setErr('');
    setOk('');
  };

  const selectMedicalDocuments = (event) => {
    const files = Array.from(event.target.files || []);
    const allowed = /\.(pdf|jpe?g|png)$/i;
    let message = '';
    if (files.length > 3) message = 'You can attach up to 3 medical documents.';
    else if (files.some((file) => !allowed.test(file.name))) message = 'Medical documents must be PDF, JPG, or PNG files.';
    else if (files.some((file) => file.size === 0 || file.size > 5 * 1024 * 1024)) message = 'Each medical document must be nonempty and 5 MB or smaller.';
    setErr(message);
    setOk('');
    setMedicalDocuments(message ? [] : files);
    if (message) event.target.value = '';
  };

  return (
    <div className="employee-leaves-page">
      <style>{`
        .employee-leaves-page {
          width: 100%;
          max-width: 1400px;
          margin: 0 auto;
          padding-bottom: 32px;
          color: #0f172a;
        }

        .leaves-page-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 24px;
        }

        .leaves-title-wrap {
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }

        .leaves-title-icon {
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

        .leaves-title-icon svg {
          width: 23px;
          height: 23px;
        }

        .leaves-page-head h1 {
          margin: 0;
          font-size: 28px;
          line-height: 1.2;
          font-weight: 750;
          letter-spacing: -.4px;
        }

        .leaves-page-head p {
          margin: 7px 0 0;
          color: #64748b;
          font-size: 14px;
          line-height: 1.5;
        }

        .leaves-refresh-btn {
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

        .leaves-refresh-btn:hover {
          border-color: #a5b4fc;
          background: #f8fbff;
          color: #4f46e5;
        }

        .leaves-refresh-btn:disabled {
          opacity: .65;
          cursor: not-allowed;
        }

        .leaves-refresh-btn svg {
          width: 16px;
          height: 16px;
        }

        .leaves-spin {
          animation: leavesSpin .8s linear infinite;
        }

        @keyframes leavesSpin {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }

        /* Summary */

        .leaves-summary {
          display: grid;
          grid-template-columns:
            repeat(4, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 22px;
        }

        .leave-stat {
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

        .leave-stat::after {
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

        .leave-stat-icon {
          width: 40px;
          height: 40px;
          border-radius: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .leave-stat-icon svg {
          width: 19px;
          height: 19px;
        }

        .leave-stat-icon.blue {
          background: #eef2ff;
          color: #4f46e5;
        }

        .leave-stat-icon.orange {
          background: #fff7ed;
          color: #ea580c;
        }

        .leave-stat-icon.green {
          background: #ecfdf5;
          color: #059669;
        }

        .leave-stat-icon.red {
          background: #fef2f2;
          color: #dc2626;
        }

        .leave-stat-label {
          margin-top: 13px;
          color: #64748b;
          font-size: 12px;
          font-weight: 600;
        }

        .leave-stat-value {
          margin-top: 4px;
          color: #0f172a;
          font-size: 22px;
          font-weight: 750;
        }

        .leave-stat-sub {
          margin-top: 4px;
          color: #94a3b8;
          font-size: 11px;
        }

        /* Panels */

        .leave-panel {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          margin-bottom: 18px;
          box-shadow:
            0 5px 18px
            rgba(15, 23, 42, .035);
          overflow: hidden;
        }

        .leave-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 18px 20px;
          border-bottom: 1px solid #eef2f7;
        }

        .leave-panel-header-left {
          display: flex;
          align-items: center;
          gap: 11px;
        }

        .leave-panel-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #eef2ff;
          color: #4f46e5;
        }

        .leave-panel-icon svg {
          width: 18px;
          height: 18px;
        }

        .leave-panel-header h2 {
          margin: 0;
          color: #1e293b;
          font-size: 15px;
          font-weight: 720;
        }

        .leave-panel-header p {
          margin: 3px 0 0;
          color: #94a3b8;
          font-size: 11px;
        }

        /* Form */

        .leave-form-body {
          padding: 20px;
        }

        .leave-form-grid {
          display: grid;
          grid-template-columns:
            repeat(3, minmax(0, 1fr));
          gap: 16px;
        }

        .leave-field {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .leave-field.full {
          grid-column: 1 / -1;
        }

        .leave-field label {
          color: #475569;
          font-size: 12px;
          font-weight: 700;
        }

        .leave-required {
          color: #dc2626;
        }

        .leave-input-wrap {
          position: relative;
        }

        .leave-input-icon {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
          width: 16px;
          height: 16px;
          pointer-events: none;
        }

        .leave-select,
        .leave-input,
        .leave-textarea {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #dbe3ef;
          border-radius: 10px;
          background: #fff;
          color: #0f172a;
          font: inherit;
          font-size: 13px;
          outline: none;
          transition:
            border-color .2s ease,
            box-shadow .2s ease;
        }

        .leave-select,
        .leave-input {
          height: 43px;
          padding: 0 12px;
        }

        .leave-select.has-icon,
        .leave-input.has-icon {
          padding-left: 38px;
        }

        .leave-textarea {
          min-height: 100px;
          padding: 11px 12px;
          resize: vertical;
          line-height: 1.5;
        }

        .leave-select:focus,
        .leave-input:focus,
        .leave-textarea:focus {
          border-color: #818cf8;
          box-shadow:
            0 0 0 3px
            rgba(79, 70, 229, .10);
        }

        .leave-help {
          margin-top: 2px;
          color: #94a3b8;
          font-size: 11px;
        }

        .leave-form-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
          margin-top: 18px;
          padding-top: 16px;
          border-top: 1px solid #eef2f7;
        }

        .leave-form-info {
          display: flex;
          align-items: center;
          gap: 9px;
          flex-wrap: wrap;
        }

        .leave-days {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 10px;
          border-radius: 8px;
          background: #eef2ff;
          color: #4338ca;
          font-size: 11px;
          font-weight: 700;
        }

        .leave-days svg {
          width: 14px;
          height: 14px;
        }

        .leave-form-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .leave-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 40px;
          padding: 0 15px;
          border-radius: 9px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all .2s ease;
        }

        .leave-btn svg {
          width: 15px;
          height: 15px;
        }

        .leave-btn.primary {
          border: 1px solid #4f46e5;
          background: #4f46e5;
          color: #fff;
        }

        .leave-btn.primary:hover {
          background: #4338ca;
          border-color: #4338ca;
        }

        .leave-btn.secondary {
          border: 1px solid #dbe3ef;
          background: #fff;
          color: #475569;
        }

        .leave-btn.secondary:hover {
          background: #f8fafc;
        }

        .leave-btn:disabled {
          opacity: .6;
          cursor: not-allowed;
        }

        .leave-message {
          display: flex;
          align-items: center;
          gap: 7px;
          width: 100%;
          padding: 10px 12px;
          border-radius: 9px;
          font-size: 12px;
          line-height: 1.4;
        }

        .leave-message.error {
          background: #fef2f2;
          color: #b91c1c;
        }

        .leave-message.success {
          background: #ecfdf5;
          color: #047857;
        }

        .leave-message svg {
          width: 15px;
          height: 15px;
          flex-shrink: 0;
        }

        /* History */

        .leave-history-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 18px 20px;
          border-bottom: 1px solid #eef2f7;
        }

        .leave-history-title {
          display: flex;
          align-items: center;
          gap: 11px;
        }

        .leave-history-title h2 {
          margin: 0;
          color: #1e293b;
          font-size: 15px;
          font-weight: 720;
        }

        .leave-history-title p {
          margin: 3px 0 0;
          color: #94a3b8;
          font-size: 11px;
        }

        .leave-count-badge {
          padding: 5px 9px;
          border-radius: 999px;
          background: #f1f5f9;
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
        }

        .leave-table-wrap {
          width: 100%;
          overflow-x: auto;
        }

        .leave-table {
          width: 100%;
          min-width: 800px;
          border-collapse: collapse;
        }

        .leave-table th {
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

        .leave-table td {
          padding: 15px 18px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
          font-size: 13px;
          vertical-align: middle;
        }

        .leave-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .leave-table tbody tr {
          transition: background .15s ease;
        }

        .leave-table tbody tr:hover {
          background: #fafcff;
        }

        .leave-type-cell {
          display: flex;
          align-items: center;
          gap: 9px;
          font-weight: 700;
          color: #1e293b;
          white-space: nowrap;
        }

        .leave-type-icon {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          background: #f1f5f9;
          color: #475569;
        }

        .leave-type-icon svg {
          width: 15px;
          height: 15px;
        }

        .leave-date-cell {
          white-space: nowrap;
          color: #475569;
          font-weight: 600;
        }

        .leave-days-cell {
          font-weight: 700;
          color: #334155;
          white-space: nowrap;
        }

        .leave-reason-cell {
          max-width: 280px;
          min-width: 180px;
          color: #64748b;
          line-height: 1.45;
        }

        .leave-rejection-reason {
          margin-top: 8px;
          color: #b91c1c;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          line-height: 1.5;
        }

        .leave-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
        }

        .leave-status svg {
          width: 13px;
          height: 13px;
        }

        .leave-status.pending {
          background: #fff7ed;
          color: #c2410c;
        }

        .leave-status.approved {
          background: #ecfdf5;
          color: #047857;
        }

        .leave-status.rejected {
          background: #fef2f2;
          color: #b91c1c;
        }

        .leave-status.unknown {
          background: #f1f5f9;
          color: #64748b;
        }

        /* Mobile history */

        .leave-mobile-list {
          display: none;
        }

        .leave-mobile-item {
          padding: 16px;
          border-bottom: 1px solid #eef2f7;
        }

        .leave-mobile-item:last-child {
          border-bottom: 0;
        }

        .leave-mobile-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .leave-mobile-type {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .leave-mobile-type h3 {
          margin: 0;
          color: #1e293b;
          font-size: 14px;
        }

        .leave-mobile-type small {
          display: block;
          margin-top: 3px;
          color: #94a3b8;
          font-size: 10px;
        }

        .leave-mobile-dates {
          display: grid;
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-top: 15px;
        }

        .leave-mobile-date {
          padding: 10px;
          border-radius: 9px;
          background: #f8fafc;
        }

        .leave-mobile-date span {
          display: flex;
          align-items: center;
          gap: 5px;
          color: #94a3b8;
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .2px;
        }

        .leave-mobile-date span svg {
          width: 11px;
          height: 11px;
        }

        .leave-mobile-date strong {
          display: block;
          margin-top: 4px;
          color: #334155;
          font-size: 11px;
        }

        .leave-mobile-reason {
          margin-top: 10px;
          padding: 10px;
          border-radius: 9px;
          background: #f8fafc;
        }

        .leave-mobile-reason span {
          display: block;
          color: #94a3b8;
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
        }

        .leave-mobile-reason p {
          margin: 4px 0 0;
          color: #475569;
          font-size: 11px;
          line-height: 1.5;
        }

        /* States */

        .leave-loading,
        .leave-empty,
        .leave-error-state {
          min-height: 240px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 30px 20px;
        }

        .leave-state-icon {
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

        .leave-state-icon.error {
          background: #fef2f2;
          color: #dc2626;
        }

        .leave-state-icon svg {
          width: 23px;
          height: 23px;
        }

        .leave-empty h3,
        .leave-error-state h3 {
          margin: 0;
          color: #1e293b;
          font-size: 15px;
          font-weight: 720;
        }

        .leave-empty p,
        .leave-error-state p {
          max-width: 430px;
          margin: 6px auto 0;
          color: #94a3b8;
          font-size: 12px;
          line-height: 1.6;
        }

        .leave-retry {
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

        .leave-retry:hover {
          background: #4338ca;
        }

        .leave-retry svg {
          width: 14px;
          height: 14px;
        }

        .leave-spinner {
          width: 18px;
          height: 18px;
          border: 2px solid #e0e7ff;
          border-top-color: #4f46e5;
          border-radius: 50%;
          animation: leavesSpin .8s linear infinite;
        }

        .leave-loading-text {
          display: flex;
          align-items: center;
          gap: 10px;
          color: #64748b;
          font-size: 13px;
        }

        @media (max-width: 1050px) {
          .leaves-summary {
            grid-template-columns:
              repeat(2, minmax(0, 1fr));
          }

          .leave-form-grid {
            grid-template-columns:
              repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 700px) {
          .employee-leaves-page {
            padding-bottom: 20px;
          }

          .leaves-page-head {
            flex-direction: column;
            margin-bottom: 18px;
          }

          .leaves-page-head h1 {
            font-size: 23px;
          }

          .leaves-title-icon {
            width: 42px;
            height: 42px;
            border-radius: 12px;
          }

          .leaves-refresh-btn {
            width: 100%;
          }

          .leaves-summary {
            grid-template-columns: 1fr 1fr;
            gap: 10px;
          }

          .leave-stat {
            padding: 14px;
            border-radius: 13px;
          }

          .leave-stat-icon {
            width: 35px;
            height: 35px;
          }

          .leave-stat-value {
            font-size: 18px;
          }

          .leave-form-body {
            padding: 14px;
          }

          .leave-form-grid {
            grid-template-columns: 1fr;
            gap: 13px;
          }

          .leave-panel-header,
          .leave-history-header {
            padding: 14px;
          }

          .leave-form-footer {
            align-items: stretch;
            flex-direction: column;
          }

          .leave-form-info {
            width: 100%;
          }

          .leave-form-actions {
            width: 100%;
          }

          .leave-btn {
            flex: 1;
          }

          .leave-table-wrap {
            display: none;
          }

          .leave-mobile-list {
            display: block;
          }
        }

        @media (max-width: 430px) {
          .leaves-summary {
            grid-template-columns: 1fr;
          }

          .leave-stat {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .leave-stat-label {
            margin-top: 0;
          }

          .leave-stat-value {
            margin-top: 2px;
          }

          .leave-stat-sub {
            display: none;
          }

          .leave-mobile-dates {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {/* Page Header */}
      <div className="leaves-page-head">
        <div className="leaves-title-wrap">
          <div className="leaves-title-icon">
            <FiCalendar />
          </div>

          <div>
            <h1>Leave Management</h1>
            <p>
              Apply for leave and track the status
              of your requests.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="leaves-refresh-btn"
          onClick={() => load(true)}
          disabled={loading || refreshing}
        >
          <FiRefreshCw
            className={
              refreshing
                ? 'leaves-spin'
                : ''
            }
          />

          {refreshing
            ? 'Refreshing...'
            : 'Refresh'}
        </button>
      </div>

      {/* Summary */}
      <div className="leaves-summary">
        <div className="leave-stat">
          <div className="leave-stat-icon blue">
            <FiFileText />
          </div>

          <div>
            <div className="leave-stat-label">
              Total Requests
            </div>

            <div className="leave-stat-value">
              {counts.total}
            </div>

            <div className="leave-stat-sub">
              All submitted requests
            </div>
          </div>
        </div>

        <div className="leave-stat">
          <div className="leave-stat-icon orange">
            <FiClock />
          </div>

          <div>
            <div className="leave-stat-label">
              Pending
            </div>

            <div className="leave-stat-value">
              {counts.pending}
            </div>

            <div className="leave-stat-sub">
              Awaiting approval
            </div>
          </div>
        </div>

        <div className="leave-stat">
          <div className="leave-stat-icon green">
            <FiCheckCircle />
          </div>

          <div>
            <div className="leave-stat-label">
              Approved
            </div>

            <div className="leave-stat-value">
              {counts.approved}
            </div>

            <div className="leave-stat-sub">
              Approved requests
            </div>
          </div>
        </div>

        <div className="leave-stat">
          <div className="leave-stat-icon red">
            <FiXCircle />
          </div>

          <div>
            <div className="leave-stat-label">
              Rejected
            </div>

            <div className="leave-stat-value">
              {counts.rejected}
            </div>

            <div className="leave-stat-sub">
              Rejected requests
            </div>
          </div>
        </div>
      </div>

      {/* Apply for Leave */}
      <div className="leave-panel">
        <div className="leave-panel-header">
          <div className="leave-panel-header-left">
            <div className="leave-panel-icon">
              <FiSend />
            </div>

            <div>
              <h2>Apply for Leave</h2>
              <p>
                Submit a new leave request
              </p>
            </div>
          </div>
        </div>

        <div className="leave-form-body">
          <div className="leave-form-grid">
            {/* Leave Type */}
            <div className="leave-field">
              <label htmlFor="lv-type">
                Leave Type{' '}
                <span className="leave-required">
                  *
                </span>
              </label>

              <div className="leave-input-wrap">
                <FiFileText className="leave-input-icon" />

                <select
                  id="lv-type"
                  className="leave-select has-icon"
                  value={f.leave_type}
                  onChange={set(
                    'leave_type'
                  )}
                >
                  {TYPES.map((type) => (
                    <option
                      key={type.value}
                      value={type.value}
                    >
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* From */}
            <div className="leave-field">
              <label htmlFor="lv-from">
                From Date{' '}
                <span className="leave-required">
                  *
                </span>
              </label>

              <div className="leave-input-wrap">
                <FiCalendar className="leave-input-icon" />

                <input
                  id="lv-from"
                  className="leave-input has-icon"
                  type="date"
                  value={f.start_date}
                  onChange={set(
                    'start_date'
                  )}
                />
              </div>
            </div>

            {/* To */}
            <div className="leave-field">
              <label htmlFor="lv-to">
                To Date{' '}
                <span className="leave-required">
                  *
                </span>
              </label>

              <div className="leave-input-wrap">
                <FiCalendar className="leave-input-icon" />

                <input
                  id="lv-to"
                  className="leave-input has-icon"
                  type="date"
                  min={f.start_date || undefined}
                  value={f.end_date}
                  onChange={set(
                    'end_date'
                  )}
                />
              </div>
            </div>

            {/* Reason */}
            <div className="leave-field full">
              <label htmlFor="lv-reason">
                Reason{' '}
                <span className="leave-required">
                  *
                </span>
              </label>

              <textarea
                id="lv-reason"
                className="leave-textarea"
                placeholder="Please provide a reason for your leave request..."
                value={f.reason}
                onChange={set('reason')}
              />

              <span className="leave-help">
                Please provide enough information
                for your manager to review the
                request.
              </span>
            </div>
          </div>

          <div className="leave-field" style={{ marginTop: 18 }}>
            <label htmlFor="lv-medical-documents">Medical documents (optional)</label>
            <input
              ref={fileInput}
              id="lv-medical-documents"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              multiple
              disabled={submitting}
              onChange={selectMedicalDocuments}
              aria-describedby="lv-medical-documents-help"
              style={{ maxWidth: '100%' }}
            />
            <span className="leave-help" id="lv-medical-documents-help">
              Attach up to 3 PDF, JPG, or PNG files, 5 MB each. Your admin can view them with this request.
            </span>
            {medicalDocuments.length > 0 && (
              <div className="leave-help">
                {medicalDocuments.map((file) => file.name).join(', ')}
                <button type="button" className="leave-btn secondary" disabled={submitting} onClick={() => {
                  setMedicalDocuments([]);
                  if (fileInput.current) fileInput.current.value = '';
                }}>Remove documents</button>
              </div>
            )}
          </div>

          {/* Form Footer */}
          <div className="leave-form-footer">
            <div className="leave-form-info">
              {requestedDays > 0 && (
                <span className="leave-days">
                  <FiCalendar />
                  {requestedDays}{' '}
                  {requestedDays === 1
                    ? 'day'
                    : 'days'}{' '}
                  requested
                </span>
              )}
            </div>

            <div className="leave-form-actions">
              <button
                type="button"
                className="leave-btn secondary"
                onClick={cancelForm}
                disabled={submitting}
              >
                <FiX />
                Clear
              </button>

              <button
                type="button"
                className="leave-btn primary"
                onClick={apply}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <FiRefreshCw className="leaves-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <FiSend />
                    Submit Request
                  </>
                )}
              </button>
            </div>

            {err && (
              <div className="leave-message error">
                <FiAlertCircle />
                <span>{err}</span>
              </div>
            )}

            {ok && (
              <div className="leave-message success">
                <FiCheckCircle />
                <span>{ok}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Leave History */}
      <div className="leave-panel">
        <div className="leave-history-header">
          <div className="leave-history-title">
            <div className="leave-panel-icon">
              <FiFileText />
            </div>

            <div>
              <h2>My Leave Requests</h2>
              <p>
                View your submitted leave history
              </p>
            </div>
          </div>

          {!loading && !err && (
            <span className="leave-count-badge">
              {list.length}{' '}
              {list.length === 1
                ? 'request'
                : 'requests'}
            </span>
          )}
        </div>

        {loading ? (
          <div className="leave-loading">
            <div className="leave-loading-text">
              <span className="leave-spinner" />
              Loading leave requests...
            </div>
          </div>
        ) : err && list.length === 0 ? (
          <div className="leave-error-state">
            <div className="leave-state-icon error">
              <FiXCircle />
            </div>

            <h3>
              Unable to load leave requests
            </h3>

            <p>{err}</p>

            <button
              type="button"
              className="leave-retry"
              onClick={() => load(true)}
              disabled={refreshing}
            >
              <FiRefreshCw
                className={
                  refreshing
                    ? 'leaves-spin'
                    : ''
                }
              />
              Try Again
            </button>
          </div>
        ) : list.length === 0 ? (
          <div className="leave-empty">
            <div className="leave-state-icon">
              <FiCalendar />
            </div>

            <h3>
              No leave requests yet
            </h3>

            <p>
              Your submitted leave requests
              will appear here.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="leave-table-wrap">
              <table className="leave-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Days</th>
                    <th>Reason</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {list.map((l) => {
                    const StatusIcon =
                      getStatusIcon(
                        l.status
                      );

                    return (
                      <tr key={l.id}>
                        <td>
                          <div className="leave-type-cell">
                            <div className="leave-type-icon">
                              <FiCalendar />
                            </div>

                            {getTypeLabel(
                              l.leave_type
                            )}
                          </div>
                        </td>

                        <td className="leave-date-cell">
                          {fmtDate(
                            l.start_date
                          )}
                        </td>

                        <td className="leave-date-cell">
                          {fmtDate(
                            l.end_date
                          )}
                        </td>

                        <td className="leave-days-cell">
                          {daysBetween(
                            l.start_date,
                            l.end_date
                          )}{' '}
                          {daysBetween(
                            l.start_date,
                            l.end_date
                          ) === 1
                            ? 'day'
                            : 'days'}
                        </td>

                        <td className="leave-reason-cell">
                          {l.reason || '-'}
                          <LeaveDocuments leave={l} />
                          {l.status === 'rejected' && l.rejection_reason && (
                            <div className="leave-rejection-reason">
                              <strong>Rejection reason: </strong>{l.rejection_reason}
                            </div>
                          )}
                        </td>

                        <td>
                          <span
                            className={`leave-status ${getStatusClass(
                              l.status
                            )}`}
                          >
                            <StatusIcon />
                            {getStatusLabel(
                              l.status
                            )}
                          </span>
                          {l.status === 'pending' && <small style={{ display: 'block', color: '#64748b' }}>With {l.manager_name || 'administrator'}</small>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="leave-mobile-list">
              {list.map((l) => {
                const StatusIcon =
                  getStatusIcon(
                    l.status
                  );

                const totalDays =
                  daysBetween(
                    l.start_date,
                    l.end_date
                  );

                return (
                  <div
                    className="leave-mobile-item"
                    key={l.id}
                  >
                    <div className="leave-mobile-top">
                      <div className="leave-mobile-type">
                        <div className="leave-type-icon">
                          <FiCalendar />
                        </div>

                        <div>
                          <h3>
                            {getTypeLabel(
                              l.leave_type
                            )}
                          </h3>

                          <small>
                            {totalDays}{' '}
                            {totalDays === 1
                              ? 'day'
                              : 'days'}{' '}
                            requested
                          </small>
                        </div>
                      </div>

                      <span
                        className={`leave-status ${getStatusClass(
                          l.status
                        )}`}
                      >
                        <StatusIcon />
                        {getStatusLabel(
                          l.status
                        )}
                      </span>
                      {l.status === 'pending' && <small style={{ display: 'block', color: '#64748b' }}>With {l.manager_name || 'administrator'}</small>}
                    </div>

                    <div className="leave-mobile-dates">
                      <div className="leave-mobile-date">
                        <span>
                          <FiCalendar />
                          From
                        </span>

                        <strong>
                          {fmtDate(
                            l.start_date
                          )}
                        </strong>
                      </div>

                      <div className="leave-mobile-date">
                        <span>
                          <FiCalendar />
                          To
                        </span>

                        <strong>
                          {fmtDate(
                            l.end_date
                          )}
                        </strong>
                      </div>
                    </div>

                    <div className="leave-mobile-reason">
                      <span>Reason</span>

                      <p>
                        {l.reason || '-'}
                      </p>
                    </div>
                    {l.status === 'rejected' && l.rejection_reason && (
                      <div className="leave-rejection-reason">
                        <strong>Rejection reason: </strong>{l.rejection_reason}
                      </div>
                    )}
                    <LeaveDocuments leave={l} />
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
