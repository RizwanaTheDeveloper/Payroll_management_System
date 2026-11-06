import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { downloadPayslip } from '../../api';
import { loanDeductionItems } from '../../utils/payrollDeductions';
import PayrollChecklist from '../../components/PayrollChecklist';
import PayrollWorkflow from '../../components/PayrollWorkflow';
import './PayrollImprovements.css';
import {
  FiCalendar,
  FiClipboard,
  FiCheckCircle,
  FiClock,
  FiDownload,
  FiEdit2,
  FiFileText,
  FiRefreshCw,
  FiUser,
  FiUsers,
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

const [currentYear, currentMonth] = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7).split('-').map(Number);

const money = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const num = (value) => Number(value) || 0;

export default function Payroll() {
  const [params] = useSearchParams();
  const [advances, setAdvances] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [payslips, setPayslips] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [revision, setRevision] = useState(0);
  const [payslipFilters, setPayslipFilters] = useState({ employee_id: '', month: '', year: '' });
  useEffect(() => {
    const id = params.get('payslip');
    if (id && payslips.length) document.getElementById(`payslip-${id}`)?.scrollIntoView({ block: 'center' });
  }, [params, payslips]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloadingId, setDownloadingId] = useState(null);

  const [form, setForm] = useState({
    employee_id: '',
    month: currentMonth,
    year: currentYear,
    allowances: 0,
    deductions: 0,
  });

  // =========================================================
  // LOAD EMPLOYEES
  // =========================================================

  const loadEmployees = async () => {
    const [response, loanResponse, advanceResponse] = await Promise.all([api.get('/employees', { params: { include_inactive: true } }), api.get('/loans'), api.get('/advances')]);
    setAdvances([...loanResponse.data, ...advanceResponse.data]);

    const activeEmployees = (
      Array.isArray(response.data)
        ? response.data
        : []
    ).filter(
      (employee) =>
        ['employee', 'manager'].includes(employee.role) &&
        (employee.is_active !== false || employee.resignation_date)
    );

    setEmployees(activeEmployees);

    setForm((prev) => {
      if (
        prev.employee_id ||
        activeEmployees.length === 0
      ) {
        return prev;
      }

      return {
        ...prev,
        employee_id: String(
          activeEmployees[0].id
        ),
      };
    });
  };

  // =========================================================
  // LOAD PAYSLIPS
  // =========================================================

  const loadPayslips = async () => {
    const response = await api.get('/payslips');

    setPayslips(
      Array.isArray(response.data)
        ? response.data
        : []
    );
  };

  const loadAll = async (refresh = false) => {
    try {
      setError('');

      if (refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      await Promise.all([
        loadEmployees(),
        loadPayslips(),
      ]);
      setRevision((value) => value + 1);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          'Failed to load payroll data.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    const refreshVisiblePayroll = () => {
      if (document.visibilityState === 'visible') {
        setRevision((value) => value + 1);
      }
    };
    window.addEventListener('focus', refreshVisiblePayroll);
    document.addEventListener('visibilitychange', refreshVisiblePayroll);
    return () => {
      window.removeEventListener('focus', refreshVisiblePayroll);
      document.removeEventListener('visibilitychange', refreshVisiblePayroll);
    };
  }, []);

  // =========================================================
  // SELECTED EMPLOYEE
  // =========================================================

  const allEmployeesSelected = form.employee_id === 'all';

  const selectedEmployee = useMemo(
    () =>
      employees.find(
        (employee) =>
          String(employee.id) ===
          String(form.employee_id)
      ),
    [employees, form.employee_id]
  );

  // =========================================================
  // EXISTING PAYSLIP
  // =========================================================

  const existingPayslip = useMemo(() => {
    if (!form.employee_id) return null;

    return (
      payslips.find(
        (payslip) =>
          String(payslip.employee_id) ===
            String(form.employee_id) &&
          Number(payslip.month) ===
            Number(form.month) &&
          Number(payslip.year) ===
            Number(form.year)
      ) || null
    );
  }, [
    payslips,
    form.employee_id,
    form.month,
    form.year,
  ]);

  // =========================================================
  // WHEN EMPLOYEE / PERIOD CHANGES
  // ONLY MONTHLY EXTRA VALUES COME FROM EXISTING PAYSLIP
  // EPF + PROFESSIONAL TAX ALWAYS COME FROM EMPLOYEE
  // =========================================================

  useEffect(() => {
    if (!selectedEmployee) return;

    setForm((prev) => ({
      ...prev,

      allowances: existingPayslip
        ? num(existingPayslip.allowances)
        : 0,
      deductions: existingPayslip ? num(existingPayslip.additional_deductions) : 0,
    }));
  }, [
    selectedEmployee,
    existingPayslip,
  ]);

  // =========================================================
  // EMPLOYEE SALARY STRUCTURE
  // =========================================================

  useEffect(() => {
    setPreview(null); setPreviewError('');
    if (!form.employee_id || form.employee_id === 'all') { setPreviewLoading(false); return; }
    const controller = new AbortController();
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      api.post('/payslips/preview', { employee_id: form.employee_id, month: form.month, year: form.year,
        allowances: form.allowances, deductions: form.deductions }, { signal: controller.signal })
        .then(({ data }) => { if (!controller.signal.aborted) setPreview(data); })
        .catch((err) => { if (!controller.signal.aborted) setPreviewError(err.response?.data?.message || 'Unable to calculate payroll preview.'); })
        .finally(() => { if (!controller.signal.aborted) setPreviewLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [form.employee_id, form.month, form.year, form.allowances, form.deductions, revision]);

  const displayPreview = existingPayslip?.status === 'finalized' ? {
    ...existingPayslip,
    gross: ['basic','hra','special_allowance','lta','other_allowances','allowances'].reduce((sum, key) => sum + num(existingPayslip[key]), 0),
    total_deductions: ['epf','professional_tax','advance','deductions'].reduce((sum, key) => sum + num(existingPayslip[key]), 0),
  } : preview;
  // Show the saved salary structure straight away; exact figures replace it once the preview returns.
  const salary = displayPreview || (selectedEmployee && !allEmployeesSelected ? selectedEmployee : {});
  const calculation = {
    gross: displayPreview?.gross || 0, advance: displayPreview?.advance || 0,
    loanDeductions: displayPreview?.calculation_snapshot?.recoveries || [],
    legacyAdvance: displayPreview?.calculation_snapshot?.legacy_advance || 0,
    totalDeductions: displayPreview?.total_deductions || 0, netPay: displayPreview?.net_pay || 0,
  };

  // =========================================================
  // CHANGE
  // =========================================================

  const handleChange = (event) => {
    const { name, value } = event.target;

    setMessage('');

    if (name === 'employee_id') {
      setForm((prev) => ({
        ...prev,
        employee_id: value,
        ...(value === 'all' ? { allowances: 0, deductions: 0 } : {}),
      }));

      return;
    }

    setForm((prev) => ({
      ...prev,
      [name]:
        value === '' ? '' : Number(value),
    }));
  };

  // =========================================================
  // GENERATE / UPDATE
  // =========================================================

  const handleGenerate = async (event) => {
    event.preventDefault();

    const mode =
      event?.nativeEvent?.submitter?.value ===
      'update'
        ? 'update'
        : 'generate';

    setError('');
    setMessage('');

    if (!form.employee_id) {
      setError(
        mode === 'update'
          ? 'Please select an employee or All employees to update.'
          : 'Please select an employee or All employees.'
      );
      return;
    }

    if (![form.allowances, form.deductions].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)) {
      setError(
        'Additional allowance and deductions must be valid non-negative amounts.'
      );
      return;
    }

    if (
      form.employee_id &&
      !allEmployeesSelected &&
      !selectedEmployee
    ) {
      setError('Employee details not found.');
      return;
    }

    if (
      form.employee_id &&
      !allEmployeesSelected &&
      preview?.missingSalary
    ) {
      setError(
        'This employee does not have a Basic Salary. Please update the employee salary structure first.'
      );
      return;
    }

    try {
      setSaving(true);

      const response = await api.post(
        '/payslips/generate',
        {
          employee_id: allEmployeesSelected ? null : Number(form.employee_id),
          month: Number(form.month),
          year: Number(form.year),
          mode,

          // Only monthly adjustments are entered here.
          allowances: form.allowances,
          deductions: form.deductions,
        }
      );

      await loadPayslips();
      setRevision((value) => value + 1);

      setMessage(
        response?.data?.message ||
          (mode === 'update'
            ? 'Payslip updated successfully.'
            : 'Payslips generated successfully.')
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          'Failed to generate payslip.'
      );
    } finally {
      setSaving(false);
    }
  };

  // =========================================================
  // DOWNLOAD
  // =========================================================

  const handleDownload = async (id) => {
    try {
      setDownloadError('');
      setDownloadingId(id);

      await downloadPayslip(id);
    } catch (err) {
      setDownloadError(
        err?.response?.data?.message ||
          'Failed to download payslip.'
      );
    } finally {
      setDownloadingId(null);
    }
  };

  // =========================================================
  // SORT
  // =========================================================

  const sortedPayslips = useMemo(
    () =>
      [...payslips].sort(
        (a, b) =>
          Number(b.year) - Number(a.year) ||
          Number(b.month) - Number(a.month)
      ),
    [payslips]
  );

  const payslipYears = useMemo(
    () => [...new Set(payslips.map((payslip) => Number(payslip.year)))].sort((a, b) => b - a),
    [payslips]
  );

  const payslipEmployees = useMemo(
    () => [...new Map(payslips.map((payslip) => [String(payslip.employee_id), {
      id: String(payslip.employee_id),
      name: payslip.name || 'Employee',
      emp_code: payslip.emp_code,
    }])).values()].sort((a, b) => a.name.localeCompare(b.name)),
    [payslips]
  );

  const filteredPayslips = useMemo(() => {
    return sortedPayslips.filter((payslip) =>
      (!payslipFilters.employee_id || String(payslip.employee_id) === payslipFilters.employee_id) &&
      (!payslipFilters.month || Number(payslip.month) === Number(payslipFilters.month)) &&
      (!payslipFilters.year || Number(payslip.year) === Number(payslipFilters.year))
    );
  }, [sortedPayslips, payslipFilters]);

  const totalNetPay = payslips.reduce(
    (sum, payslip) =>
      sum + num(payslip.net_pay),
    0
  );

  return (
    <div className="payroll-page">
      <style>{`
        .payroll-page {
          width: 100%;
          max-width: 1450px;
          margin: 0 auto;
          padding-bottom: 40px;
          color: #0f172a;
        }

        .payroll-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 24px;
        }

        .payroll-header-left {
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }

        .header-icon {
          width: 50px;
          height: 50px;
          border-radius: 14px;
          background: #eef2ff;
          color: #4f46e5;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .header-icon svg {
          width: 24px;
          height: 24px;
        }

        .payroll-header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 750;
        }

        .payroll-header p {
          margin: 7px 0 0;
          color: #64748b;
          font-size: 14px;
        }

        .refresh-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 40px;
          padding: 0 14px;
          border: 1px solid #dbe3ef;
          border-radius: 10px;
          background: white;
          color: #334155;
          font-weight: 650;
          cursor: pointer;
        }

        .refresh-btn:disabled {
          opacity: .6;
          cursor: not-allowed;
        }

        .spin {
          animation: spin .8s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin-bottom: 20px;
        }

        .summary-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 18px;
          box-shadow: 0 5px 18px rgba(15,23,42,.04);
        }

        .summary-icon {
          width: 40px;
          height: 40px;
          border-radius: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #eef2ff;
          color: #4f46e5;
        }

        .summary-label {
          margin-top: 12px;
          color: #64748b;
          font-size: 12px;
          font-weight: 600;
        }

        .summary-value {
          margin-top: 4px;
          font-size: 21px;
          font-weight: 750;
        }

        .main-grid {
          display: grid;
          grid-template-columns: 1.25fr .75fr;
          gap: 18px;
          margin-bottom: 20px;
        }

        .card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 5px 18px rgba(15,23,42,.035);
        }

        .card-header {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 18px 20px;
          border-bottom: 1px solid #eef2f7;
        }

        .card-header-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: #eef2ff;
          color: #4f46e5;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .card-header h2 {
          margin: 0;
          font-size: 15px;
          font-weight: 720;
        }

        .card-header p {
          margin: 3px 0 0;
          color: #94a3b8;
          font-size: 11px;
        }

        .form-body {
          padding: 20px;
        }

        .form-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }

        .full {
          grid-column: 1 / -1;
        }

        .form-group label {
          display: block;
          margin-bottom: 7px;
          color: #475569;
          font-size: 12px;
          font-weight: 650;
        }

        .form-input,
        .form-select {
          width: 100%;
          height: 43px;
          box-sizing: border-box;
          padding: 0 12px;
          border: 1px solid #dbe3ef;
          border-radius: 10px;
          background: white;
          color: #0f172a;
          outline: none;
          font-size: 13px;
        }

        .form-input:focus,
        .form-select:focus {
          border-color: #818cf8;
          box-shadow: 0 0 0 3px rgba(79, 70, 229,.1);
        }

        .form-input.readonly {
          background: #f8fafc;
          color: #475569;
          cursor: not-allowed;
        }

        .section-title {
          grid-column: 1 / -1;
          margin-top: 4px;
          padding-bottom: 8px;
          border-bottom: 1px solid #eef2f7;
          font-size: 13px;
          font-weight: 750;
          color: #1e293b;
        }

        .salary-grid {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }

        .salary-box {
          padding: 12px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
        }

        .salary-box span {
          display: block;
          color: #64748b;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
        }

        .salary-box strong {
          display: block;
          margin-top: 5px;
          color: #1e293b;
          font-size: 13px;
        }

        .source-note {
          grid-column: 1 / -1;
          padding: 10px 12px;
          border-radius: 9px;
          background: #eef2ff;
          color: #4338ca;
          font-size: 11px;
          line-height: 1.5;
        }

        .form-actions {
          display: flex;
          justify-content: flex-end;
          margin-top: 20px;
          padding-top: 18px;
          border-top: 1px solid #eef2f7;
        }

        .generate-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-height: 43px;
          padding: 0 18px;
          border: 0;
          border-radius: 10px;
          background: #4f46e5;
          color: white;
          font-weight: 700;
          cursor: pointer;
        }

        .generate-btn:disabled {
          opacity: .6;
          cursor: not-allowed;
        }

        .message {
          margin-bottom: 16px;
          padding: 10px 12px;
          border-radius: 9px;
          font-size: 12px;
        }

        .success {
          background: #ecfdf5;
          color: #047857;
        }

        .error {
          background: #fef2f2;
          color: #b91c1c;
        }

        .preview-body {
          padding: 20px;
        }

        .employee-card {
          padding: 14px;
          border: 1px solid #e0e7ff;
          border-radius: 12px;
          background: #f8fbff;
          margin-bottom: 16px;
        }

        .employee-top {
          display: flex;
          align-items: center;
          gap: 11px;
        }

        .avatar {
          width: 40px;
          height: 40px;
          border-radius: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #e0e7ff;
          color: #4f46e5;
        }

        .employee-card strong {
          display: block;
          font-size: 13px;
        }

        .employee-card span {
          display: block;
          margin-top: 3px;
          color: #64748b;
          font-size: 11px;
        }

        .source-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          margin-top: 10px;
          padding: 5px 8px;
          border-radius: 999px;
          background: #ecfdf5;
          color: #047857;
          font-size: 10px;
          font-weight: 700;
        }

        .existing {
          margin-bottom: 14px;
          padding: 8px 10px;
          border-radius: 8px;
          background: #fff7ed;
          color: #c2410c;
          font-size: 10px;
          font-weight: 700;
        }

        .calc-list {
          border-top: 1px solid #eef2f7;
        }

        .calc-row {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          padding: 11px 0;
          border-bottom: 1px solid #f1f5f9;
          font-size: 12px;
        }

        .calc-row span {
          color: #64748b;
        }

        .calc-row strong {
          color: #334155;
        }

        .gross strong {
          color: #4f46e5;
        }

        .deduction strong {
          color: #dc2626;
        }

        .net-box {
          margin-top: 15px;
          padding: 15px;
          border: 1px solid #bbf7d0;
          border-radius: 12px;
          background: #ecfdf5;
        }

        .net-box small {
          color: #047857;
          font-weight: 700;
        }

        .net-box strong {
          display: block;
          margin-top: 4px;
          color: #047857;
          font-size: 24px;
        }

        .list-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          overflow: hidden;
        }

        .list-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 18px 20px;
          border-bottom: 1px solid #eef2f7;
        }

        .table-wrap {
          overflow-x: auto;
        }

        .payroll-payslip-filters {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          gap: 16px;
          padding: 18px 20px;
          border-bottom: 1px solid var(--border);
        }

        .payroll-payslip-filters label {
          display: grid;
          gap: 8px;
          flex: 1 1 180px;
          min-width: 0;
          font-weight: 600;
        }

        .payroll-payslip-filters :is(input, select) {
          width: 100%;
          min-width: 0;
        }

        table {
          width: 100%;
          min-width: 780px;
          border-collapse: collapse;
        }

        .table-wrap :is(th, td) {
          white-space: nowrap;
        }

        th {
          padding: 12px 18px;
          background: #f8fafc;
          color: #64748b;
          font-size: 12px;
          text-align: left;
          text-transform: uppercase;
        }

        td {
          padding: 14px 18px;
          border-bottom: 1px solid #f1f5f9;
          font-size: 12px;
        }

        .net-pay {
          color: #047857;
          font-weight: 750;
        }

                .download-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          min-height: 32px;
          padding: 0 10px;
          border: 1px solid #dbe3ef;
          border-radius: 8px;
          background: #fff;
          color: #334155;
          cursor: pointer;
          font-size: 11px;
          font-weight: 700;
          transition: all .2s ease;
        }

        .download-btn:hover {
          color: #4f46e5;
          border-color: #a5b4fc;
          background: #eef2ff;
        }

        .download-btn:disabled {
          opacity: .6;
          cursor: not-allowed;
        }

        .download-btn svg {
          width: 14px;
          height: 14px;
        }

        .download-error {
          margin: 14px 18px;
          padding: 10px;
          border-radius: 8px;
          background: #fef2f2;
          color: #b91c1c;
          font-size: 12px;
        }

        .empty {
          padding: 50px 20px;
          text-align: center;
          color: #64748b;
          font-size: 13px;
        }

        @media (max-width: 1050px) {
          .main-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 750px) {
          .summary-grid {
            grid-template-columns: 1fr;
          }

          .form-grid {
            grid-template-columns: 1fr;
          }

          .full,
          .salary-grid {
            grid-column: auto;
          }

          .salary-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 550px) {
          .payroll-header {
            flex-direction: column;
          }

          .refresh-btn {
            width: 100%;
            justify-content: center;
          }

          .salary-grid {
            grid-template-columns: 1fr;
          }

          .form-actions {
            flex-direction: column;
          }

          .generate-btn {
            width: 100%;
            justify-content: center;
          }
        }
      `}</style>

      {/* HEADER */}

      <div className="payroll-header">
        <div className="payroll-header-left">
          <div className="header-icon">
            <FiClipboard />
          </div>

          <div>
            <h1>Payroll Generation</h1>
            <p>
              Generate and update monthly
              employee payslips.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="refresh-btn"
          onClick={() => loadAll(true)}
          disabled={refreshing}
        >
          <FiRefreshCw
            className={
              refreshing ? 'spin' : ''
            }
          />
          {refreshing
            ? 'Refreshing...'
            : 'Refresh'}
        </button>
      </div>

      {/* SUMMARY */}

      <PayrollChecklist month={form.month} year={form.year} revision={revision} />

      <div className="summary-grid">
        <div className="summary-card">
          <div className="summary-icon">
            <FiUsers />
          </div>
          <div className="summary-label">
            Active Employees
          </div>
          <div className="summary-value">
            {employees.length}
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-icon">
            <FiFileText />
          </div>
          <div className="summary-label">
            Generated Payslips
          </div>
          <div className="summary-value">
            {payslips.length}
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-icon">
            <FiClipboard />
          </div>
          <div className="summary-label">
            Total Net Pay
          </div>
          <div className="summary-value">
            {money(totalNetPay)}
          </div>
        </div>
      </div>

      {error && (
        <div className="message error">
          {error}
        </div>
      )}

      {/* GENERATION */}

      <div className="main-grid">
        {/* FORM */}

        <div className="card">
          <div className="card-header">
            <div className="card-header-icon">
              <FiEdit2 />
            </div>

            <div>
              <h2>
                Generate / Update Payslip
              </h2>
              <p>
                Employee salary information is
                fetched from Add Employee.
              </p>
            </div>
          </div>

          <form
            className="form-body"
            onSubmit={handleGenerate}
          >
            {message && (
              <div className="message success">
                {message}
              </div>
            )}

            <div className="form-grid">
              {/* EMPLOYEE */}

              <div className="form-group full">
                <label>
                  Employee
                </label>

                <select
                  name="employee_id"
                  className="form-select"
                  value={form.employee_id}
                  onChange={handleChange}
                  disabled={saving}
                >
                  <option value="">
                    Select employee
                  </option>
                  <option value="all">All employees</option>

                  {employees.map(
                    (employee) => (
                      <option
                        key={employee.id}
                        value={employee.id}
                      >
                        {employee.emp_code
                          ? `${employee.emp_code} - `
                          : ''}
                        {employee.name}
                      </option>
                    )
                  )}
                </select>
              </div>

              {/* MONTH */}

              <div className="form-group">
                <label>
                  Salary Month
                </label>

                <select
                  name="month"
                  className="form-select"
                  value={form.month}
                  onChange={handleChange}
                  disabled={saving}
                >
                  {MONTHS.map(
                    (month, index) => (
                      <option
                        key={month}
                        value={index + 1}
                      >
                        {month}
                      </option>
                    )
                  )}
                </select>
              </div>

              {/* YEAR */}

              <div className="form-group">
                <label>
                  Salary Year
                </label>

                <input
                  type="number"
                  name="year"
                  className="form-input"
                  min="2000"
                  max="2100"
                  value={form.year}
                  onChange={handleChange}
                  disabled={saving}
                />
              </div>

              {allEmployeesSelected ? (
                <div className="source-note">
                  Generate payroll for all eligible active employees for the selected month and year.
                  Each employee's effective salary history, employment dates and scheduled loan deductions will be used.
                  Existing payslips and employees without a basic salary are skipped. New payslips are saved as drafts for review.
                </div>
              ) : (
                <>
              <div className="section-title">
                Employee Salary Structure
              </div>

              <div className="source-note">
                These values are fetched directly
                from the selected employee's Add
                Employee record.
              </div>

              <div className="salary-grid">
                <div className="salary-box">
                  <span>Basic Salary</span>
                  <strong>
                    {money(salary.basic)}
                  </strong>
                </div>

                <div className="salary-box">
                  <span>HRA</span>
                  <strong>
                    {money(salary.hra)}
                  </strong>
                </div>

                <div className="salary-box">
                  <span>Special Allowance</span>
                  <strong>
                    {money(
                      salary.special_allowance
                    )}
                  </strong>
                </div>

                <div className="salary-box">
                  <span>LTA</span>
                  <strong>
                    {money(salary.lta)}
                  </strong>
                </div>

                <div className="salary-box">
                  <span>Other Allowances</span>
                  <strong>
                    {money(
                      salary.other_allowances
                    )}
                  </strong>
                </div>

                <div className="salary-box">
                  <span>EPF</span>
                  <strong>
                    {money(salary.epf)}
                  </strong>
                </div>

                <div className="salary-box">
                  <span>Professional Tax</span>
                  <strong>
                    {money(
                      salary.professional_tax
                    )}
                  </strong>
                </div>
              </div>
                </>
              )}
            </div>

            <div className="form-actions">
              <label className="payroll-adjustment-field">Additional deductions<input type="number" name="deductions" min="0" step="0.01" value={form.deductions} onChange={handleChange} disabled={saving || existingPayslip?.status === 'finalized'} /></label>
              <button
                type="submit"
                value={existingPayslip ? "update" : "generate"}
                className="generate-btn"
                disabled={saving || (!allEmployeesSelected && (previewLoading || !preview || !!previewError || preview.missingSalary || preview.net_pay < 0)) || existingPayslip?.status === "finalized"}
              >
                {saving ? (
                  <>
                    <FiRefreshCw className="spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <FiFileText />
                    {allEmployeesSelected
                      ? 'Generate Payroll for All Employees'
                      : existingPayslip?.status === 'finalized' ? 'Payslip locked' : existingPayslip ? 'Update Draft Payslip' : 'Generate Draft Payslip'}
                  </>
                )}
              </button>

              {allEmployeesSelected && (
                <button type="submit" value="update" className="generate-btn" disabled={saving}
                  onClick={(e) => { if (!window.confirm('Recalculate all existing draft payslips for this month with the latest EPF and Professional Tax? Finalized or paid payslips are not changed.')) e.preventDefault(); }}>
                  <FiRefreshCw /> Update All Draft Payslips (EPF &amp; PT)
                </button>
              )}

              {/*
              <button
                type="submit"
                value="update"
                className="generate-btn"
                style={{
                  marginLeft: 10,
                  background: '#10b981',
                }}
                disabled={saving || !form.employee_id}
              >
                <FiEdit2 />
                Update Payslip
              </button>
              */}
            </div>
          </form>
        </div>

        {/* PREVIEW */}

        <div className="card">
          <div className="card-header">
            <div className="card-header-icon">
              <FiClipboard />
            </div>

            <div>
              <h2>Payroll Preview</h2>
              <p>
                Calendar-day proration using effective salary history.
              </p>
            </div>
          </div>

          <div className="preview-body">
            {previewLoading ? <p role="status">Calculating payroll...</p> : previewError ? <p role="alert">{previewError}</p> : !selectedEmployee ? (
              <div className="empty">
                {allEmployeesSelected
                  ? `Payroll will be generated for all eligible active employees for ${MONTHS[Number(form.month) - 1]} ${form.year}. Select an individual employee to preview their payroll details.`
                  : 'Select an employee to view payroll details.'}
              </div>
            ) : (
              <>
                <div className="employee-card">
                  <div className="employee-top">
                    <div className="avatar">
                      <FiUser />
                    </div>

                    <div>
                      <strong>
                        {selectedEmployee.name}
                      </strong>

                      <span>
                        {selectedEmployee.emp_code ||
                          'Employee'}
                        {selectedEmployee.designation
                          ? ` • ${selectedEmployee.designation}`
                          : ''}
                      </span>
                    </div>
                  </div>

                  <div className="source-badge">
                    <FiCheckCircle />
                    Effective Salary History
                  </div>
                </div>

                {existingPayslip && (
                  <div className="existing">
                    Existing payslip found for{' '}
                    {MONTHS[
                      Number(form.month) - 1
                    ]}{' '}
                    {form.year}. Status: {existingPayslip.status}. {existingPayslip.status === 'finalized' ? 'Reopen with a correction reason to change this payslip.' : 'Saving changes returns it to draft for review.'}
                  </div>
                )}
                {existingPayslip && existingPayslip.additional_deductions == null && num(existingPayslip.deductions) > 0 && <p className="payroll-policy-note">This older payslip stores Loss Of Pay and other deductions as a combined amount. Verify the additional deduction field before recalculating it.</p>}
                {selectedEmployee && !allEmployeesSelected && existingPayslip?.status !== 'finalized' && (
                  <button
                    type="button"
                    className="reports-secondary"
                    disabled={previewLoading}
                    onClick={() => setRevision((value) => value + 1)}
                  >
                    <FiRefreshCw className={previewLoading ? 'spin' : undefined} />
                    Refresh attendance &amp; preview
                  </button>
                )}

                <div className="calc-list">
                  {displayPreview?.warnings?.map((warning) => <p key={warning} className="payroll-workflow-error" role="status">{warning}</p>)}
                  {displayPreview?.employed_days != null && <p className="payroll-policy-note">
                    {displayPreview.employed_days} employment days · {displayPreview.calculation_snapshot?.unpaid_dates?.length ?? 0} unpaid leave days · {displayPreview.net_paid_days} paid days · {displayPreview.month_days} calendar days
                  </p>}
                  <div className="calc-row">
                    <span>Basic</span>
                    <strong>
                      {money(salary.basic)}
                    </strong>
                  </div>

                  <div className="calc-row">
                    <span>HRA</span>
                    <strong>
                      {money(salary.hra)}
                    </strong>
                  </div>

                  <div className="calc-row">
                    <span>Special Allowance</span>
                    <strong>
                      {money(
                        salary.special_allowance
                      )}
                    </strong>
                  </div>

                  <div className="calc-row">
                    <span>LTA</span>
                    <strong>
                      {money(salary.lta)}
                    </strong>
                  </div>

                  <div className="calc-row">
                    <span>Other Allowances</span>
                    <strong>
                      {money(
                        salary.other_allowances
                      )}
                    </strong>
                  </div>

                  <div className="calc-row">
                    <span>
                      Additional Allowance
                    </span>
                    <strong>
                      {money(form.allowances)}
                    </strong>
                  </div>

                  <div className="calc-row gross">
                    <span>
                      Gross Earnings
                    </span>
                    <strong>
                      {money(
                        calculation.gross
                      )}
                    </strong>
                  </div>

                  <div className="calc-row deduction"><span>Loss Of Pay</span><strong className={num(salary.unpaid_leave_deduction) > 0 ? undefined : 'muted-zero'}>{num(salary.unpaid_leave_deduction) > 0 ? '-' : ''}{money(salary.unpaid_leave_deduction)}</strong></div>
                  {num(salary.late_login_deduction) > 0 && <><div className="calc-row deduction"><span>Late login (half day)</span><strong>-{money(salary.late_login_deduction)}</strong></div><p className="payroll-policy-note">{salary.late_login_reason}</p></>}
                  <div className="calc-row deduction"><span>Additional deductions</span><strong className={num(salary.additional_deductions) > 0 ? undefined : 'muted-zero'}>{num(salary.additional_deductions) > 0 ? '-' : ''}{money(salary.additional_deductions)}</strong></div>
                  <div className="calc-row deduction">
                    <span>EPF</span>
                    <strong className={num(salary.epf) > 0 ? undefined : 'muted-zero'}>
                      {num(salary.epf) > 0 ? '-' : ''}{money(salary.epf)}
                    </strong>
                  </div>

                  <div className="calc-row deduction">
                    <span>
                      Professional Tax
                    </span>
                    <strong className={num(salary.professional_tax) > 0 ? undefined : 'muted-zero'}>
                      {num(salary.professional_tax) > 0 ? '-' : ''}{money(
                        salary.professional_tax
                      )}
                    </strong>
                  </div>

                  {calculation.loanDeductions.map((entry) => (
                    <div className="calc-row deduction" key={entry.advance_id}>
                      <Link to={entry.record_type === 'salary_advance' ? `/admin/advances?advance=${entry.advance_id}` : `/admin/loans?loan=${entry.advance_id}`}>
                        {entry.record_type === 'salary_advance' ? `Salary advance ADV-${entry.advance_id}` : `Loan LOAN-${entry.advance_id} (incl. interest)`}
                      </Link>
                      <strong>-{money(entry.amount)}</strong>
                    </div>
                  ))}
                  {calculation.legacyAdvance > 0 && (
                    <div className="calc-row deduction">
                      <span>Salary advance</span>
                      <strong>
                        -{money(calculation.legacyAdvance)}
                      </strong>
                    </div>
                  )}

                  <div className="calc-row deduction">
                    <span>
                      Total Deductions
                    </span>
                    <strong className={num(calculation.totalDeductions) > 0 ? undefined : 'muted-zero'}>
                      {num(calculation.totalDeductions) > 0 ? '-' : ''}{money(
                        calculation.totalDeductions
                      )}
                    </strong>
                  </div>
                </div>

                <div className="net-box">
                  <small>NET PAY</small>

                  <strong>
                    {money(calculation.netPay)}
                  </strong>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* GENERATED PAYSLIPS */}

      <div className="list-card">
        <div className="list-header">
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 15,
              }}
            >
              Generated Payslips
            </h2>

            <p
              style={{
                margin: '3px 0 0',
                color: '#94a3b8',
                fontSize: 11,
              }}
            >
              Previously generated employee
              payslips
            </p>
          </div>

          <strong>
            {filteredPayslips.length} / {payslips.length}
          </strong>
        </div>

        <div className="payroll-payslip-filters" role="group" aria-label="Filter generated payslips">
          <label htmlFor="payslip-employee-filter">
            Employee
            <select
              id="payslip-employee-filter"
              value={payslipFilters.employee_id}
              onChange={(event) => setPayslipFilters((current) => ({ ...current, employee_id: event.target.value }))}
            >
              <option value="">All employees</option>
              {payslipEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.emp_code ? `${employee.emp_code} - ` : ''}{employee.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="payslip-month-filter">
            Month
            <select
              id="payslip-month-filter"
              value={payslipFilters.month}
              onChange={(event) => setPayslipFilters((current) => ({ ...current, month: event.target.value }))}
            >
              <option value="">All months</option>
              {MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
            </select>
          </label>
          <label htmlFor="payslip-year-filter">
            Year
            <select
              id="payslip-year-filter"
              value={payslipFilters.year}
              onChange={(event) => setPayslipFilters((current) => ({ ...current, year: event.target.value }))}
            >
              <option value="">All years</option>
              {payslipYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="download-btn"
            disabled={!payslipFilters.employee_id && !payslipFilters.month && !payslipFilters.year}
            onClick={() => setPayslipFilters({ employee_id: '', month: '', year: '' })}
          >
            Clear filters
          </button>
        </div>

        {downloadError && (
          <div className="download-error">
            {downloadError}
          </div>
        )}

        {loading ? (
          <div className="empty">
            Loading payslips...
          </div>
        ) : filteredPayslips.length === 0 ? (
          <div className="empty" role="status">
            {payslips.length === 0 ? 'No payslips generated yet.' : 'No payslips match the selected filters.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Period</th>
                  <th>Basic</th>
                  <th>EPF</th>
                  <th>Prof. tax</th>
                  <th>Loan deduction</th>
                  <th>Net Pay</th>
                  <th>Payroll status</th>
                  <th>Payment</th>
                  <th>Review / payment</th>
                  <th>PDF</th>
                </tr>
              </thead>

              <tbody>
                {filteredPayslips.map(
                  (payslip) => (
                    <tr key={payslip.id} id={`payslip-${payslip.id}`} style={params.get('payslip') === String(payslip.id) ? { background: 'var(--primary-l)' } : undefined}>
                      <td>
                        <strong>
                          {payslip.name ||
                            'Employee'}
                        </strong>
                        <div
                          style={{
                            color: '#94a3b8',
                            fontSize: 10,
                            marginTop: 3,
                          }}
                        >
                          {payslip.emp_code ||
                            `ID ${payslip.employee_id}`}
                        </div>
                      </td>

                      <td>
                        {MONTHS[
                          Number(payslip.month) -
                            1
                        ]}{' '}
                        {payslip.year}
                      </td>

                      <td>
                        {money(payslip.basic)}
                      </td>

                      <td>
                        {money(payslip.epf)}
                      </td>

                      <td>
                        {money(
                          payslip.professional_tax
                        )}
                      </td>

                      <td>
                        {money(payslip.advance)}
                        {loanDeductionItems(payslip).map((entry) => <div key={entry.id}>{entry.id === 'advance' ? entry.label : <Link to={entry.href}>{entry.label}</Link>} · {money(entry.amount)}</div>)}
                      </td>
                      <td>
                        <span className="net-pay">
                          {money(
                            payslip.net_pay
                          )}
                        </span>
                      </td>

                      <td><span className={`payroll-state payroll-state-${payslip.status}`}>{payslip.status}</span></td>
                      <td><span className={`payroll-state payroll-state-${payslip.payment_status}`}>{payslip.payment_status}</span></td>
                      <td><PayrollWorkflow payslip={payslip} onChanged={async () => { await loadPayslips(); setRevision((value) => value + 1); }} /></td>
                      <td>
                        <button
                          type="button"
                          className="download-btn"
                          onClick={() =>
                            handleDownload(
                              payslip.id
                            )
                          }
                          disabled={
                            downloadingId ===
                            payslip.id
                          }
                        >
                          {downloadingId ===
                          payslip.id ? (
                            <>
                              <FiClock />
                              Downloading
                            </>
                          ) : (
                            <>
                              <FiDownload />
                              Download
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
