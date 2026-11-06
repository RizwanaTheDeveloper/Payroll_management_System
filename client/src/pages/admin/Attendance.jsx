import { useEffect, useMemo, useState } from 'react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';

import {
  FiCalendar,
  FiCheck,
  FiCheckCircle,
  FiClock,
  FiFileText,
  FiRefreshCw,
  FiUsers,
  FiX,
  FiXCircle,
  FiMinusCircle,
  FiEdit3,
  FiSave,
  FiList,
  FiSun,
  FiMoon,
  FiAlertCircle,
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

const todayStr = () => new Date().toLocaleDateString('en-CA');

const formatDate = (value) => {
  if (!value) return '-';

  const datePart = String(value).slice(0, 10);
  const [year, month, day] = datePart.split('-').map(Number);

  if (!year || !month || !day) return value;

  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const formatTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-';

const calculateHours = (attendance) =>
  attendance.check_in && attendance.check_out
    ? (
        (new Date(attendance.check_out) -
          new Date(attendance.check_in)) /
        36e5
      ).toFixed(2) + ' h'
    : '-';

const LABEL = {
  present: 'Present',
  absent: 'Unpaid Leave',
  leave: 'Leave',
  paid_leave: 'Paid Leave',
};

const BADGE = {
  present: 'approved',
  absent: 'rejected',
  leave: 'pending',
  paid_leave: 'approved',
};

const ATTENDANCE_CHOICES = [
  { label: 'Full Day', status: 'present', day_type: 'full', Icon: FiSun },
  { label: 'Half Day', status: 'present', day_type: 'half', Icon: FiClock },
  { label: 'Leave', status: 'leave', day_type: 'full', Icon: FiCalendar },
];

/* =========================================================
   MARK DAY
========================================================= */

function MarkDay() {
  const team = useAuth().user?.role === 'manager';
  const [date, setDate] = useState(todayStr());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');

  const load = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    setMessage('');
    setMessageType('');

    try {
      const response = await api.get('/attendance/day', {
        params: { date },
      });

      const data = Array.isArray(response.data) ? response.data : [];

      setRows(
        data.map((employee) => ({
          ...employee,
          status: employee.status || '',
          loaded_status: employee.status || '',
          day_type: employee.day_type || 'full',
          note: employee.note || '',
        }))
      );
    } catch (error) {
      setMessage(
        error.response?.data?.message ||
          'Failed to load attendance records.'
      );
      setMessageType('error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, [date]);

  const update = (id, patch) => {
    setRows((currentRows) =>
      currentRows.map((row) =>
        row.employee_id === id
          ? {
              ...row,
              ...patch,
            }
          : row
      )
    );
  };

  const markAll = (status) => {
    setRows((currentRows) =>
      currentRows.map((row) => ({
        ...row,
        status,
        day_type: 'full',
      }))
    );

    setMessage(
      status === 'present'
        ? 'All employees marked as present. Click Save to apply changes.'
        : 'All attendance selections cleared. Click Save to apply changes.'
    );

    setMessageType('info');
  };

  const save = async () => {
    setSaving(true);
    setMessage('');
    setMessageType('');

    try {
      const records = rows.map(
        ({ employee_id, status, loaded_status, recorded_status, day_type, note }) => ({
          employee_id,
          status: status === loaded_status ? (recorded_status ?? status) : status,
          day_type,
          note,
        })
      );

      await api.put('/attendance/bulk', {
        work_date: date,
        records,
      });

      setMessage('Attendance saved successfully.');
      setMessageType('success');

      await load();
    } catch (error) {
      setMessage(
        error.response?.data?.message ||
          'Failed to save attendance.'
      );
      setMessageType('error');
    } finally {
      setSaving(false);
    }
  };

  const summary = useMemo(() => {
    const present = rows.filter(
      (row) => row.status === 'present'
    ).length;

    const absent = rows.filter(
      (row) => row.status === 'absent'
    ).length;

    const leave = rows.filter(
      (row) => ['leave', 'paid_leave'].includes(row.status)
    ).length;

    const unmarked = rows.filter(
      (row) => !row.status
    ).length;

    return {
      total: rows.length,
      present,
      absent,
      leave,
      unmarked,
    };
  }, [rows]);

  return (
    <div className="attendance-section">
      {/* Summary */}
      <div className="attendance-summary">
        <div className="attendance-summary-card">
          <div className="summary-icon blue">
            <FiUsers />
          </div>
          <div>
            <span>{team ? 'Team members' : 'Total Employees'}</span>
            <strong>{summary.total}</strong>
          </div>
        </div>

        <div className="attendance-summary-card">
          <div className="summary-icon green">
            <FiCheckCircle />
          </div>
          <div>
            <span>Present</span>
            <strong>{summary.present}</strong>
          </div>
        </div>

        <div className="attendance-summary-card">
          <div className="summary-icon red">
            <FiXCircle />
          </div>
          <div>
            <span>Unpaid Leave</span>
            <strong>{summary.absent}</strong>
          </div>
        </div>

        <div className="attendance-summary-card">
          <div className="summary-icon amber">
            <FiCalendar />
          </div>
          <div>
            <span>Leave</span>
            <strong>{summary.leave}</strong>
          </div>
        </div>

        <div className="attendance-summary-card">
          <div className="summary-icon gray">
            <FiMinusCircle />
          </div>
          <div>
            <span>Not Marked</span>
            <strong>{summary.unmarked}</strong>
          </div>
        </div>
      </div>

      {/* Date / Actions */}
      <div className="attendance-control-card">
        <div className="attendance-control-left">
          <div className="section-icon">
            <FiCalendar />
          </div>

          <div>
            <h2>Mark Daily Attendance</h2>
            <p>
              Select a date and update attendance for each employee.
            </p>
          </div>
        </div>

        <div className="attendance-date-control">
          <label htmlFor="attendance-date">Attendance Date</label>

          <div className="date-input-wrap">
            <FiCalendar />
            <input
              id="attendance-date"
              type="date"
              value={date}
              max="9999-12-31"
              onChange={(event) =>
                event.target.value &&
                setDate(event.target.value)
              }
            />
          </div>
        </div>
      </div>

      {/* Bulk Actions */}
      <div className="bulk-action-card">
        <div className="bulk-action-heading">
          <div>
            <h3>Quick Actions</h3>
            <p>
              {team ? 'Apply attendance status to your whole team at once.' : 'Apply attendance status to all employees at once.'}
            </p>
          </div>
        </div>

        <div className="bulk-actions">
          <button
            type="button"
            className="attendance-btn success"
            onClick={() => markAll('present')}
          >
            <FiCheck />
            Mark All Present
          </button>

          <button
            type="button"
            className="attendance-btn refresh"
            onClick={() => load(true)}
            disabled={refreshing || loading}
          >
            <FiRefreshCw
              className={refreshing ? 'spin' : ''}
            />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>

        </div>

        {message && (
          <div className={`attendance-message ${messageType}`}>
            {messageType === 'success' && <FiCheckCircle />}
            {messageType === 'error' && <FiAlertCircle />}
            {messageType === 'info' && <FiClock />}
            <span>{message}</span>
          </div>
        )}
      </div>

      {/* Employee Attendance Table */}
      <div className="attendance-table-card">
        <div className="table-card-header">
          <div>
            <h2>{team ? 'Team attendance' : 'Employee Attendance'}</h2>
            <p>
              {formatDate(date)} · {rows.length} employee
              {rows.length === 1 ? '' : 's'}
            </p>
          </div>

          <div className="table-header-status">
            <span className="status-dot green-dot" />
            {summary.present} Present
          </div>
        </div>

        <div className="attendance-table-wrap">
          <table className="attendance-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Attendance</th>
                <th>Note</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr key={row.employee_id}>
                  <td data-label="Employee">
                    <div className="employee-cell">
                      <div className="employee-avatar">
                        {String(row.name || 'E')
                          .charAt(0)
                          .toUpperCase()}
                      </div>

                      <div className="employee-info">
                        <strong>{row.name}</strong>

                        {row.emp_code && (
                          <span>{row.emp_code}</span>
                        )}
                      </div>
                    </div>
                  </td>

                  <td data-label="Attendance">
                    <div className="attendance-choice-grid" role="group" aria-label={`Attendance for ${row.name}`}>
                      {ATTENDANCE_CHOICES.map(({ label, status, day_type, Icon }) => {
                        const recordedStatus = row.status === row.loaded_status
                          ? (row.recorded_status ?? row.status)
                          : row.status;
                        const selected = (status === 'leave'
                          ? ['leave', 'paid_leave'].includes(recordedStatus)
                          : recordedStatus === status) && row.day_type === day_type;
                        const unpaidByPolicy = selected && status === 'leave' && recordedStatus === 'leave' && row.status === 'absent';
                        return (
                          <button
                            key={label}
                            type="button"
                            className={`attendance-choice ${status} ${selected ? 'selected' : ''} ${unpaidByPolicy ? 'unpaid' : ''}`}
                            aria-pressed={selected}
                            disabled={saving}
                            onClick={() => update(row.employee_id, {
                              status: selected ? '' : status,
                              day_type,
                            })}
                          >
                            <Icon />
                            <span>{unpaidByPolicy ? 'Unpaid Leave' : label}</span>
                            {selected && <FiCheck className="choice-check" />}
                          </button>
                        );
                      })}
                    </div>
                    {row.status === 'absent' && (
                      <small>
                        {['leave', 'paid_leave'].includes(row.recorded_status)
                          ? 'This leave exceeds the two paid leave days for the month and will be deducted in payroll.'
                          : 'Previously marked as unpaid. Unpaid days are deducted in payroll.'}
                      </small>
                    )}
                  </td>

                  <td data-label="Note">
                    <div className="note-input-wrap">
                      <FiEdit3 />

                      <input
                        type="text"
                        value={row.note}
                        placeholder="Optional note"
                        disabled={!row.status}
                        onChange={(event) =>
                          update(row.employee_id, {
                            note: event.target.value,
                          })
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {loading && (
            <div className="attendance-empty">
              <div className="loading-spinner">
                <FiRefreshCw />
              </div>

              <strong>Loading employees...</strong>

              <span>
                Please wait while attendance data is loaded.
              </span>
            </div>
          )}

          {!loading && rows.length === 0 && (
            <div className="attendance-empty">
              <div className="empty-icon">
                <FiUsers />
              </div>

              <strong>No employees found</strong>

              <span>
                There are no employees available for attendance
                marking.
              </span>
            </div>
          )}
        </div>

        <div className="attendance-save-bar">
          <span className="attendance-save-hint">
            {rows.filter((row) => row.status !== row.loaded_status).length > 0
              ? `${rows.filter((row) => row.status !== row.loaded_status).length} unsaved change${rows.filter((row) => row.status !== row.loaded_status).length === 1 ? '' : 's'}`
              : 'All changes saved'}
          </span>
          <button
            type="button"
            className="attendance-btn primary"
            onClick={save}
            disabled={saving || loading || rows.length === 0}
          >
            <FiSave />
            {saving ? 'Saving...' : 'Save Attendance'}
          </button>
        </div>
      </div>

      <style>{`
        .attendance-choice-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(100px, 110px));
          gap: 6px;
          min-width: 0;
          overflow-x: auto;
        }
        .attendance-choice {
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 44px;
          padding: 8px 10px;
          border: 1px solid #dbe3ef;
          border-radius: 8px;
          background: #fff;
          color: #475569;
          font: inherit;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }
        .attendance-choice:hover { border-color: #4f46e5; background: #eef2ff; }
        .attendance-choice:focus-visible { outline: 3px solid #a5b4fc; outline-offset: 2px; }
        .attendance-choice.selected { border-color: #059669; background: #ecfdf5; color: #047857; }
        .attendance-choice.leave.selected { border-color: #d97706; background: #fffbeb; color: #b45309; }
        .attendance-choice.leave.unpaid.selected { border-color: #dc2626; background: #fee2e2; color: #991b1b; box-shadow: inset 0 0 0 1px #dc2626; }
        .attendance-choice:disabled { opacity: .6; cursor: wait; }
        .choice-check { margin-left: auto; }
        .attendance-section {
          width: 100%;
        }

        .attendance-summary {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 18px;
        }

        .attendance-summary-card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 17px;
          display: flex;
          align-items: center;
          gap: 13px;
          min-width: 0;
          box-shadow: 0 3px 12px rgba(15, 23, 42, 0.04);
        }

        .summary-icon {
          width: 42px;
          height: 42px;
          min-width: 42px;
          border-radius: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 19px;
        }

        .summary-icon.blue {
          background: #eef2ff;
          color: #4f46e5;
        }

        .summary-icon.green {
          background: #ecfdf5;
          color: #059669;
        }

        .summary-icon.red {
          background: #fef2f2;
          color: #dc2626;
        }

        .summary-icon.amber {
          background: #fffbeb;
          color: #d97706;
        }

        .summary-icon.gray {
          background: #f3f4f6;
          color: #6b7280;
        }

        .attendance-summary-card span {
          display: block;
          color: #64748b;
          font-size: 12px;
          margin-bottom: 4px;
        }

        .attendance-summary-card strong {
          display: block;
          color: #0f172a;
          font-size: 22px;
          line-height: 1.1;
        }

        .attendance-control-card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
          margin-bottom: 14px;
          box-shadow: 0 3px 12px rgba(15, 23, 42, 0.04);
        }

        .attendance-control-left {
          display: flex;
          align-items: center;
          gap: 13px;
          min-width: 0;
        }

        .section-icon {
          width: 44px;
          height: 44px;
          min-width: 44px;
          border-radius: 12px;
          background: #eef2ff;
          color: #4f46e5;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
        }

        .attendance-control-left h2,
        .table-card-header h2 {
          margin: 0;
          color: #0f172a;
          font-size: 17px;
          font-weight: 700;
        }

        .attendance-control-left p,
        .table-card-header p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .attendance-date-control {
          min-width: 230px;
        }

        .attendance-date-control label {
          display: block;
          color: #475569;
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 6px;
        }

        .date-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .date-input-wrap svg {
          position: absolute;
          left: 12px;
          color: #64748b;
          pointer-events: none;
        }

        .date-input-wrap input {
          width: 100%;
          height: 42px;
          border: 1px solid #d1d5db;
          border-radius: 10px;
          background: #ffffff;
          color: #0f172a;
          padding: 0 12px 0 36px;
          font-size: 13px;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .date-input-wrap input:focus {
          border-color: #4f46e5;
          box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
        }

        .bulk-action-card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 18px 20px;
          margin-bottom: 14px;
          box-shadow: 0 3px 12px rgba(15, 23, 42, 0.04);
        }

        .bulk-action-heading h3 {
          margin: 0;
          color: #0f172a;
          font-size: 15px;
          font-weight: 700;
        }

        .bulk-action-heading p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 12px;
        }

        .bulk-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 9px;
          margin-top: 14px;
        }

        .attendance-btn {
          min-height: 40px;
          border: 1px solid transparent;
          border-radius: 9px;
          padding: 0 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.18s ease;
          white-space: nowrap;
        }

        .attendance-btn svg {
          font-size: 15px;
        }

        .attendance-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .attendance-btn.primary {
          background: #4f46e5;
          color: #ffffff;
        }

        .attendance-btn.primary:hover:not(:disabled) {
          background: #4338ca;
        }

        .attendance-btn.success {
          background: #059669;
          color: #ffffff;
        }

        .attendance-btn.success:hover:not(:disabled) {
          background: #047857;
        }

        .attendance-btn.secondary {
          background: #ffffff;
          border-color: #d1d5db;
          color: #475569;
        }

        .attendance-btn.secondary:hover:not(:disabled) {
          background: #f8fafc;
          border-color: #94a3b8;
        }

        .attendance-btn.refresh {
          background: #ffffff;
          border-color: #dbe3ef;
          color: #334155;
        }

        .attendance-btn.refresh:hover:not(:disabled) {
          background: #f8fafc;
        }

        .attendance-message {
          margin-top: 13px;
          padding: 10px 12px;
          border-radius: 9px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 500;
        }

        .attendance-message.success {
          background: #ecfdf5;
          color: #047857;
          border: 1px solid #a7f3d0;
        }

        .attendance-message.error {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fecaca;
        }

        .attendance-message.info {
          background: #eef2ff;
          color: #4338ca;
          border: 1px solid #c7d2fe;
        }

        .attendance-table-card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 3px 12px rgba(15, 23, 42, 0.04);
        }

        .table-card-header {
          padding: 18px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 15px;
          border-bottom: 1px solid #eef2f7;
        }

        .table-header-status {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          background: #ecfdf5;
          color: #047857;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
        }

        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          display: inline-block;
        }

        .green-dot {
          background: #10b981;
        }

        .attendance-table-wrap {
          width: 100%;
          overflow-x: auto;
        }

        .attendance-table {
          width: 100%;
          min-width: 850px;
          border-collapse: collapse;
        }

        .attendance-table th {
          background: #f8fafc;
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          text-align: left;
          padding: 12px 18px;
          border-bottom: 1px solid #e5e7eb;
          white-space: nowrap;
        }

        .attendance-table td {
          padding: 13px 18px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
          font-size: 13px;
          vertical-align: middle;
        }

        .attendance-table tbody tr:last-child td {
          border-bottom: none;
        }

        .attendance-table tbody tr:hover {
          background: #fafcff;
        }

        .employee-cell {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 180px;
        }

        .employee-avatar {
          width: 36px;
          height: 36px;
          min-width: 36px;
          border-radius: 10px;
          background: #eef2ff;
          color: #4f46e5;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
        }

        .employee-info {
          min-width: 0;
        }

        .employee-info strong {
          display: block;
          color: #0f172a;
          font-size: 13px;
          font-weight: 650;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .employee-info span {
          display: block;
          color: #94a3b8;
          font-size: 11px;
          margin-top: 2px;
        }

        .attendance-select {
          height: 38px;
          min-width: 125px;
          border: 1px solid #dbe3ef;
          border-radius: 8px;
          background: #ffffff;
          color: #334155;
          padding: 0 30px 0 10px;
          font-size: 12px;
          font-weight: 500;
          outline: none;
          cursor: pointer;
        }

        .attendance-select:focus {
          border-color: #4f46e5;
          box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.08);
        }

        .attendance-select:disabled {
          background: #f8fafc;
          color: #94a3b8;
          cursor: not-allowed;
        }

        .status-select.present {
          border-color: #a7f3d0;
          background: #ecfdf5;
          color: #047857;
        }

        .status-select.absent {
          border-color: #fecaca;
          background: #fef2f2;
          color: #b91c1c;
        }

        .status-select.leave {
          border-color: #fde68a;
          background: #fffbeb;
          color: #b45309;
        }

        .status-select.not-marked {
          color: #64748b;
        }

        .note-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
          min-width: 220px;
        }

        .note-input-wrap svg {
          position: absolute;
          left: 11px;
          color: #94a3b8;
          pointer-events: none;
          font-size: 14px;
        }

        .note-input-wrap input {
          width: 100%;
          height: 38px;
          border: 1px solid #dbe3ef;
          border-radius: 8px;
          padding: 0 10px 0 32px;
          color: #334155;
          font-size: 12px;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .note-input-wrap input:focus {
          border-color: #4f46e5;
          box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.08);
        }

        .note-input-wrap input:disabled {
          background: #f8fafc;
          color: #94a3b8;
          cursor: not-allowed;
        }

        .attendance-empty {
          min-height: 240px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 35px 20px;
          color: #64748b;
          text-align: center;
        }

        .attendance-empty strong {
          color: #334155;
          font-size: 14px;
        }

        .attendance-empty span {
          font-size: 12px;
        }

        .empty-icon,
        .loading-spinner {
          width: 46px;
          height: 46px;
          border-radius: 13px;
          background: #f1f5f9;
          color: #64748b;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          margin-bottom: 4px;
        }

        .loading-spinner {
          animation: spin 1s linear infinite;
        }

        .spin {
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1200px) {
          .attendance-summary {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 800px) {
          .attendance-summary {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .attendance-control-card {
            flex-direction: column;
            align-items: stretch;
          }

          .attendance-date-control {
            min-width: 0;
            width: 100%;
          }

          .table-card-header {
            align-items: flex-start;
            flex-direction: column;
          }
        }

        @media (max-width: 600px) {
          .attendance-summary {
            grid-template-columns: 1fr 1fr;
            gap: 9px;
          }

          .attendance-summary-card {
            padding: 12px;
            gap: 9px;
          }

          .summary-icon {
            width: 36px;
            height: 36px;
            min-width: 36px;
            font-size: 16px;
          }

          .attendance-summary-card strong {
            font-size: 18px;
          }

          .attendance-summary-card span {
            font-size: 10px;
          }

          .attendance-control-card,
          .bulk-action-card {
            padding: 15px;
            border-radius: 13px;
          }

          .attendance-control-left {
            align-items: flex-start;
          }

          .section-icon {
            width: 38px;
            height: 38px;
            min-width: 38px;
          }

          .attendance-control-left h2,
          .table-card-header h2 {
            font-size: 15px;
          }

          .attendance-control-left p,
          .table-card-header p {
            font-size: 11px;
          }

          .bulk-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }

          .attendance-btn {
            width: 100%;
            padding: 0 8px;
            font-size: 11px;
          }

          .attendance-table-card {
            border-radius: 13px;
          }

          .table-card-header {
            padding: 15px;
          }

          .attendance-table,
          .attendance-table tbody,
          .attendance-table tr,
          .attendance-table td {
            display: block;
            width: 100%;
          }

          .attendance-table thead {
            display: none;
          }

          .attendance-table {
            min-width: 0;
          }

          .attendance-table tbody {
            padding: 8px;
          }

          .attendance-table tr {
            background: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            margin-bottom: 10px;
            padding: 10px;
          }

          .attendance-table tbody tr:hover {
            background: #ffffff;
          }

          .attendance-table td {
            display: grid;
            grid-template-columns: 90px minmax(0, 1fr);
            gap: 10px;
            align-items: center;
            padding: 9px 4px;
            border-bottom: 1px solid #f1f5f9;
          }

          .attendance-table td:last-child {
            border-bottom: none;
          }

          .attendance-table td::before {
            content: attr(data-label);
            color: #64748b;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }

          .employee-cell {
            min-width: 0;
          }

          .attendance-select {
            width: 100%;
            min-width: 0;
          }

          .note-input-wrap {
            min-width: 0;
          }

          .attendance-message {
            align-items: flex-start;
          }
        }

        @media (max-width: 380px) {
          .attendance-summary {
            grid-template-columns: 1fr;
          }

          .bulk-actions {
            grid-template-columns: 1fr;
          }

          .attendance-table td {
            grid-template-columns: 80px minmax(0, 1fr);
          }
        }
      `}</style>
    </div>
  );
}

/* =========================================================
   MONTHLY RECORDS
========================================================= */

function Records() {
  const now = new Date();

  const [monthYear, setMonthYear] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState('');

  const load = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    setError('');

    try {
      const response = await api.get('/attendance', {
        params: monthYear,
      });

      setList(
        Array.isArray(response.data)
          ? response.data
          : []
      );
    } catch (err) {
      setError(
        err.response?.data?.message ||
          'Failed to load attendance records.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, [monthYear]);

  const summary = useMemo(() => {
    const present = list.filter(
      (item) => item.status === 'present'
    ).length;

    const absent = list.filter(
      (item) => item.status === 'absent'
    ).length;

    const leave = list.filter(
      (item) => ['leave', 'paid_leave'].includes(item.status)
    ).length;

    const completed = list.filter(
      (item) => !item.status && item.check_out
    ).length;

    return {
      present,
      absent,
      leave,
      completed,
    };
  }, [list]);

  return (
    <div className="records-section">
      {/* Month Controls */}
      <div className="records-filter-card">
        <div className="records-filter-title">
          <div className="section-icon">
            <FiList />
          </div>

          <div>
            <h2>Monthly Attendance Records</h2>
            <p>
              The first two leave days each month are paid. Additional days count as unpaid leave.
            </p>
          </div>
        </div>

        <div className="records-filters">
          <div className="records-field">
            <label>Month</label>

            <div className="records-input">
              <FiCalendar />

              <select
                value={monthYear.month}
                onChange={(event) =>
                  setMonthYear({
                    ...monthYear,
                    month: Number(event.target.value),
                  })
                }
              >
                {MONTHS.map((name, index) => (
                  <option
                    key={name}
                    value={index + 1}
                  >
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="records-field">
            <label>Year</label>

            <div className="records-input">
              <FiCalendar />

              <input
                type="number"
                min="2000"
                max="9999"
                value={monthYear.year}
                onChange={(event) =>
                  setMonthYear({
                    ...monthYear,
                    year: Number(event.target.value),
                  })
                }
              />
            </div>
          </div>

          <button
            type="button"
            className="records-refresh"
            onClick={() => load(true)}
            disabled={refreshing || loading}
          >
            <FiRefreshCw
              className={refreshing ? 'spin' : ''}
            />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="records-summary">
        <div className="records-summary-card">
          <div className="records-summary-icon blue">
            <FiFileText />
          </div>

          <div>
            <span>Total Records</span>
            <strong>{list.length}</strong>
          </div>
        </div>

        <div className="records-summary-card">
          <div className="records-summary-icon green">
            <FiCheckCircle />
          </div>

          <div>
            <span>Present</span>
            <strong>{summary.present}</strong>
          </div>
        </div>

        <div className="records-summary-card">
          <div className="records-summary-icon red">
            <FiXCircle />
          </div>

          <div>
            <span>Unpaid Leave</span>
            <strong>{summary.absent}</strong>
          </div>
        </div>

        <div className="records-summary-card">
          <div className="records-summary-icon amber">
            <FiCalendar />
          </div>

          <div>
            <span>Leave</span>
            <strong>{summary.leave}</strong>
          </div>
        </div>

        <div className="records-summary-card">
          <div className="records-summary-icon purple">
            <FiClock />
          </div>

          <div>
            <span>Completed</span>
            <strong>{summary.completed}</strong>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="records-error">
          <FiAlertCircle />
          <span>{error}</span>
        </div>
      )}

      {/* Table */}
      <div className="records-table-card">
        <div className="records-table-header">
          <div>
            <h2>
              {MONTHS[monthYear.month - 1]} {monthYear.year}
            </h2>

            <p>
              {list.length} record
              {list.length === 1 ? '' : 's'} found
            </p>
          </div>

          <div className="records-header-badge">
            <FiCalendar />
            {MONTHS[monthYear.month - 1]} {monthYear.year}
          </div>
        </div>

        <div className="records-table-wrap">
          <table className="records-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Employee</th>
                <th>Status</th>
                <th>Check In</th>
                <th>Check Out</th>
                <th>Hours</th>
                <th>Note</th>
              </tr>
            </thead>

            <tbody>
              {list.map((attendance) => (
                <tr key={attendance.id}>
                  <td data-label="Date">
                    <div className="record-date">
                      <FiCalendar />
                      <span>
                        {formatDate(
                          attendance.work_date
                        )}
                      </span>
                    </div>
                  </td>

                  <td data-label="Employee">
                    <div className="record-employee">
                      <div className="record-avatar">
                        {String(
                          attendance.name || 'E'
                        )
                          .charAt(0)
                          .toUpperCase()}
                      </div>

                      <div>
                        <strong>
                          {attendance.name}
                        </strong>

                        {attendance.emp_code && (
                          <span>
                            {attendance.emp_code}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  <td data-label="Status">
                    {attendance.status ? (
                      <span
                        className={`record-badge ${
                          BADGE[attendance.status] ||
                          'pending'
                        }`}
                      >
                        {attendance.status ===
                          'present' && <FiCheck />}

                        {attendance.status ===
                          'absent' && <FiX />}

                        {attendance.status ===
                          'leave' && <FiCalendar />}

                        {LABEL[attendance.status] ||
                          attendance.status}

                        {attendance.day_type ===
                          'half' && (
                          <small>(Half Day)</small>
                        )}
                      </span>
                    ) : attendance.check_out ? (
                      <span className="record-badge approved">
                        <FiCheckCircle />
                        Completed
                      </span>
                    ) : attendance.check_in ? (
                      <span className="record-badge working">
                        <FiClock />
                        Working
                      </span>
                    ) : (
                      <span className="record-badge neutral">
                        <FiMinusCircle />
                        Not Marked
                      </span>
                    )}
                  </td>

                  <td data-label="Check In">
                    <div className="time-cell">
                      <FiClock />
                      {formatTime(attendance.check_in)}
                    </div>
                  </td>

                  <td data-label="Check Out">
                    <div className="time-cell">
                      <FiClock />
                      {formatTime(
                        attendance.check_out
                      )}
                    </div>
                  </td>

                  <td data-label="Hours">
                    <strong className="hours-value">
                      {calculateHours(attendance)}
                    </strong>
                  </td>

                  <td data-label="Note">
                    <span className="record-note">
                      {attendance.note || '-'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {loading && (
            <div className="records-empty">
              <div className="loading-spinner">
                <FiRefreshCw />
              </div>

              <strong>Loading attendance records...</strong>

              <span>
                Please wait while the records are loaded.
              </span>
            </div>
          )}

          {!loading && list.length === 0 && (
            <div className="records-empty">
              <div className="records-empty-icon">
                <FiFileText />
              </div>

              <strong>
                No attendance records found
              </strong>

              <span>
                There are no attendance records for{' '}
                {MONTHS[monthYear.month - 1]}{' '}
                {monthYear.year}.
              </span>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .records-section {
          width: 100%;
        }

        .records-filter-card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
          margin-bottom: 14px;
          box-shadow: 0 3px 12px rgba(15, 23, 42, 0.04);
        }

        .records-filter-title {
          display: flex;
          align-items: center;
          gap: 13px;
          min-width: 0;
        }

        .records-filter-title h2,
        .records-table-header h2 {
          margin: 0;
          color: #0f172a;
          font-size: 17px;
          font-weight: 700;
        }

        .records-filter-title p,
        .records-table-header p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .records-filters {
          display: flex;
          align-items: flex-end;
          gap: 10px;
        }

        .records-field label {
          display: block;
          color: #475569;
          font-size: 11px;
          font-weight: 600;
          margin-bottom: 5px;
        }

        .records-input {
          position: relative;
          display: flex;
          align-items: center;
        }

        .records-input svg {
          position: absolute;
          left: 10px;
          color: #64748b;
          pointer-events: none;
          font-size: 14px;
        }

        .records-input select,
        .records-input input {
          height: 40px;
          border: 1px solid #dbe3ef;
          border-radius: 9px;
          background: #ffffff;
          color: #334155;
          font-size: 12px;
          outline: none;
          padding-left: 32px;
          padding-right: 10px;
        }

        .records-input select {
          min-width: 145px;
        }

        .records-input input {
          width: 100px;
        }

        .records-input select:focus,
        .records-input input:focus {
          border-color: #4f46e5;
          box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.08);
        }

        .records-refresh {
          height: 40px;
          border: 1px solid #dbe3ef;
          background: #ffffff;
          color: #334155;
          border-radius: 9px;
          padding: 0 13px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }

        .records-refresh:hover:not(:disabled) {
          background: #f8fafc;
        }

        .records-refresh:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .records-summary {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 14px;
        }

        .records-summary-card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 3px 12px rgba(15, 23, 42, 0.04);
        }

        .records-summary-icon {
          width: 40px;
          height: 40px;
          min-width: 40px;
          border-radius: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
        }

        .records-summary-icon.blue {
          background: #eef2ff;
          color: #4f46e5;
        }

        .records-summary-icon.green {
          background: #ecfdf5;
          color: #059669;
        }

        .records-summary-icon.red {
          background: #fef2f2;
          color: #dc2626;
        }

        .records-summary-icon.amber {
          background: #fffbeb;
          color: #d97706;
        }

        .records-summary-icon.purple {
          background: #f5f3ff;
          color: #7c3aed;
        }

        .records-summary-card span {
          display: block;
          color: #64748b;
          font-size: 11px;
          margin-bottom: 4px;
        }

        .records-summary-card strong {
          display: block;
          color: #0f172a;
          font-size: 21px;
        }

        .records-error {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 11px 13px;
          margin-bottom: 14px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          border-radius: 10px;
          font-size: 13px;
        }

        .records-table-card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 3px 12px rgba(15, 23, 42, 0.04);
        }

        .records-table-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 15px;
          padding: 18px 20px;
          border-bottom: 1px solid #eef2f7;
        }

        .records-header-badge {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          background: #eef2ff;
          color: #4f46e5;
          padding: 7px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
        }

        .records-table-wrap {
          width: 100%;
          overflow-x: auto;
        }

        .records-table {
          width: 100%;
          min-width: 1050px;
          border-collapse: collapse;
        }

        .records-table th {
          background: #f8fafc;
          color: #64748b;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          text-align: left;
          padding: 12px 17px;
          border-bottom: 1px solid #e5e7eb;
          white-space: nowrap;
        }

        .records-table td {
          padding: 13px 17px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
          font-size: 12px;
          vertical-align: middle;
        }

        .records-table tbody tr:last-child td {
          border-bottom: none;
        }

        .records-table tbody tr:hover {
          background: #fafcff;
        }

        .record-date {
          display: flex;
          align-items: center;
          gap: 7px;
          color: #475569;
          white-space: nowrap;
        }

        .record-date svg {
          color: #94a3b8;
        }

        .record-employee {
          display: flex;
          align-items: center;
          gap: 9px;
          min-width: 170px;
        }

        .record-avatar {
          width: 34px;
          height: 34px;
          min-width: 34px;
          border-radius: 9px;
          background: #eef2ff;
          color: #4f46e5;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
        }

        .record-employee strong {
          display: block;
          color: #0f172a;
          font-size: 12px;
          font-weight: 650;
          white-space: nowrap;
        }

        .record-employee span {
          display: block;
          color: #94a3b8;
          font-size: 10px;
          margin-top: 2px;
        }

        .record-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border-radius: 999px;
          padding: 5px 9px;
          font-size: 10px;
          font-weight: 650;
          white-space: nowrap;
        }

        .record-badge svg {
          font-size: 12px;
        }

        .record-badge small {
          font-size: 9px;
          margin-left: 2px;
        }

        .record-badge.approved {
          background: #ecfdf5;
          color: #047857;
        }

        .record-badge.rejected {
          background: #fef2f2;
          color: #b91c1c;
        }

        .record-badge.pending {
          background: #fffbeb;
          color: #b45309;
        }

        .record-badge.working {
          background: #eef2ff;
          color: #4338ca;
        }

        .record-badge.neutral {
          background: #f1f5f9;
          color: #64748b;
        }

        .time-cell {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #475569;
          white-space: nowrap;
        }

        .time-cell svg {
          color: #94a3b8;
          font-size: 13px;
        }

        .hours-value {
          color: #0f172a;
          white-space: nowrap;
        }

        .record-note {
          color: #64748b;
          display: block;
          max-width: 180px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .records-empty {
          min-height: 240px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 35px 20px;
          text-align: center;
          color: #64748b;
        }

        .records-empty strong {
          color: #334155;
          font-size: 14px;
        }

        .records-empty span {
          font-size: 12px;
        }

        .records-empty-icon,
        .records-section .loading-spinner {
          width: 46px;
          height: 46px;
          border-radius: 13px;
          background: #f1f5f9;
          color: #64748b;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          margin-bottom: 4px;
        }

        @media (max-width: 1200px) {
          .records-summary {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .records-filter-card {
            align-items: flex-start;
            flex-direction: column;
          }

          .records-filters {
            width: 100%;
          }
        }

        @media (max-width: 700px) {
          .records-summary {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 9px;
          }

          .records-filter-card {
            padding: 15px;
            border-radius: 13px;
          }

          .records-filters {
            display: grid;
            grid-template-columns: 1fr 100px;
            width: 100%;
          }

          .records-field {
            min-width: 0;
          }

          .records-input select,
          .records-input input {
            width: 100%;
            min-width: 0;
          }

          .records-refresh {
            grid-column: 1 / -1;
            width: 100%;
          }

          .records-table-card {
            border-radius: 13px;
          }

          .records-table-header {
            padding: 15px;
            align-items: flex-start;
            flex-direction: column;
          }

          .records-header-badge {
            display: none;
          }

          .records-table,
          .records-table tbody,
          .records-table tr,
          .records-table td {
            display: block;
            width: 100%;
          }

          .records-table thead {
            display: none;
          }

          .records-table {
            min-width: 0;
          }

          .records-table tbody {
            padding: 8px;
          }

          .records-table tr {
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            margin-bottom: 10px;
            padding: 8px;
            background: #ffffff;
          }

          .records-table td {
            display: grid;
            grid-template-columns: 90px minmax(0, 1fr);
            gap: 10px;
            align-items: center;
            padding: 9px 4px;
            border-bottom: 1px solid #f1f5f9;
          }

          .records-table td:last-child {
            border-bottom: none;
          }

          .records-table td::before {
            content: attr(data-label);
            color: #64748b;
            font-size: 9px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }

          .record-note {
            max-width: none;
          }
        }

        @media (max-width: 380px) {
          .records-summary {
            grid-template-columns: 1fr;
          }

          .records-filters {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function Attendance() {
  const [tab, setTab] = useState('mark');
  const team = useAuth().user?.role === 'manager';

  return (
    <div className="attendance-page">
      <div className="page-head">
        <div>
          <div className="attendance-page-title">
            <div className="attendance-page-icon">
              <FiClock />
            </div>

            <div>
              <h1>{team ? 'Team attendance' : 'Attendance & Leave'}</h1>

              <p>
                {team ? 'Mark daily attendance for your direct reports and review their monthly records.' : 'Manage employee attendance, working hours and leave records.'}
              </p>
            </div>
          </div>
        </div>

        <div className="attendance-tabs">
          <button
            type="button"
            className={
              tab === 'mark'
                ? 'attendance-tab active'
                : 'attendance-tab'
            }
            onClick={() => setTab('mark')}
          >
            <FiEdit3 />
            <span>Mark Attendance</span>
          </button>

          <button
            type="button"
            className={
              tab === 'records'
                ? 'attendance-tab active'
                : 'attendance-tab'
            }
            onClick={() => setTab('records')}
          >
            <FiList />
            <span>Monthly Records</span>
          </button>
        </div>
      </div>

      {tab === 'mark' ? <MarkDay /> : <Records />}

      <style>{`
        .attendance-page {
          width: 100%;
        }

        .attendance-page .page-head {
          margin-bottom: 18px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 18px;
        }

        .attendance-page-title {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .attendance-page-icon {
          width: 46px;
          height: 46px;
          min-width: 46px;
          border-radius: 13px;
          background: #eef2ff;
          color: #4f46e5;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 21px;
        }

        .attendance-page h1 {
          margin: 0;
          color: #0f172a;
          font-size: 24px;
          font-weight: 750;
          line-height: 1.2;
        }

        .attendance-page-title p {
          margin: 5px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .attendance-tabs {
          display: inline-flex;
          align-items: center;
          padding: 4px;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          border-radius: 11px;
          gap: 3px;
        }

        .attendance-tab {
          min-height: 38px;
          border: none;
          background: transparent;
          color: #64748b;
          border-radius: 8px;
          padding: 0 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          font-size: 12px;
          font-weight: 650;
          cursor: pointer;
          transition: all 0.18s ease;
          white-space: nowrap;
        }

        .attendance-tab:hover {
          color: #334155;
          background: #ffffff;
        }

        .attendance-tab.active {
          color: #4f46e5;
          background: #ffffff;
          box-shadow: 0 2px 5px rgba(15, 23, 42, 0.08);
        }

        .attendance-tab svg {
          font-size: 15px;
        }

        @media (max-width: 900px) {
          .attendance-page .page-head {
            align-items: flex-start;
            flex-direction: column;
          }

          .attendance-tabs {
            width: 100%;
          }

          .attendance-tab {
            flex: 1;
          }
        }

        @media (max-width: 600px) {
          .attendance-page h1 {
            font-size: 20px;
          }

          .attendance-page-title p {
            font-size: 11px;
          }

          .attendance-page-icon {
            width: 40px;
            height: 40px;
            min-width: 40px;
            font-size: 18px;
          }

          .attendance-tabs {
            width: 100%;
          }

          .attendance-tab {
            padding: 0 8px;
            font-size: 10px;
          }

          .attendance-tab svg {
            font-size: 14px;
          }
        }
      `}</style>
    </div>
  );
}
