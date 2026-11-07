import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../../api';

import {
  FiPlus,
  FiEdit2,
  FiTrash2,
  FiSearch,
  FiX,
  FiSave,
  FiUser,
  FiCalendar,
  FiCreditCard,
  FiCheckCircle,
  FiAlertCircle,
  FiUsers,
} from 'react-icons/fi';

import { FaRupeeSign } from 'react-icons/fa';

/*
 * Monthly salary components / earnings
 */
const salaryKeys = [
  'basic',
  'hra',
  'special_allowance',
  'lta',
  'other_allowances',
];

/*
 * Monthly salary deductions
 */
const deductionKeys = [
  'epf',
  'professional_tax',
];

const salaryLabels = {
  basic: 'Basic Salary',
  hra: 'HRA (House Rent Allowance)',
  special_allowance: 'Special Allowance',
  lta: 'LTA (Leave Travel Allowance)',
  other_allowances: 'Other Allowances',
};

const deductionLabels = {
  epf: 'EPF (Employees\' Provident Fund)',
  professional_tax: 'Professional Tax',
};

const todayStr = () => new Date().toISOString().slice(0, 10);

const emptyForm = {
  salary_effective_from: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
  salary_change_reason: '',
  emp_code: '',
  name: '',
  email: '',
  password: '',
  require_password_change: true,
  pending_password_change: false,
  designation: '',
  department: '',
  role: 'employee',
  manager_id: '',
  gender: '',
  dob: '',
  pan: '',
  pf_uan: '',
  joining_date: todayStr(),
  resignation_date: '',
  ctc: '',
  tax_regime: 'new',

  // Earnings
  basic: '',
  hra: '',
  special_allowance: '',
  lta: '',
  other_allowances: '',

  // Deductions
  epf: '',
  professional_tax: '',

  // Bank
  bank_name: '',
  bank_branch: '',
  account_number: '',
  ifsc_code: '',
};

const money = (value) => {
  if (value === null || value === undefined || value === '') return '-';

  const number = Number(value);

  if (Number.isNaN(number)) return '-';

  return `₹${number.toLocaleString('en-IN', {
    maximumFractionDigits: 0,
  })}`;
};

const buildSalaryFromCtc = (ctcValue) => {
  const annualCtc = Number(ctcValue);

  if (!Number.isFinite(annualCtc) || annualCtc <= 0) {
    return {
      basic: '',
      hra: '',
      special_allowance: '',
      lta: '',
      other_allowances: '',
      epf: '',
      professional_tax: '',
    };
  }

  const monthlyCtc = annualCtc / 12;
  const basic = monthlyCtc * 0.4;
  const hra = basic * 0.5;
  const specialAllowance = basic * 0.2;
  const lta = basic * 0.1;
  const otherAllowances =
    monthlyCtc -
    basic -
    hra -
    specialAllowance -
    lta;

  const round2 = (value) => Number(value.toFixed(2));

  return {
    basic: String(round2(basic)),
    hra: String(round2(hra)),
    special_allowance: String(round2(specialAllowance)),
    lta: String(round2(lta)),
    other_allowances: String(round2(otherAllowances)),
    // Andhra Pradesh statutory deductions: EPF 12% of basic (wage cap 15,000); PT slabs on monthly gross.
    epf: String(Math.round(Math.min(basic, 15000) * 0.12)),
    professional_tax: String(
      monthlyCtc > 20000 ? 200 : monthlyCtc > 15000 ? 150 : 0
    ),
  };
};

function Toast({ toast, onClose }) {
  if (!toast) return null;

  const success = toast.type === 'success';

  return (
    <div className={`employee-toast ${success ? 'success' : 'error'}`}>
      <div className="employee-toast-icon">
        {success ? <FiCheckCircle /> : <FiAlertCircle />}
      </div>

      <div className="employee-toast-message">
        {toast.message}
      </div>

      <button
        type="button"
        className="employee-toast-close"
        onClick={onClose}
        aria-label="Close notification"
      >
        <FiX />
      </button>
    </div>
  );
}

function SectionHeader({ icon, title, description }) {
  return (
    <div className="employee-section-header">
      <div className="employee-section-icon">
        {icon}
      </div>

      <div>
        <h3>{title}</h3>

        {description && <p>{description}</p>}
      </div>
    </div>
  );
}

export default function Employees() {
  const [salaryHistory, setSalaryHistory] = useState([]);
  const [salaryHistoryError, setSalaryHistoryError] = useState('');
  const reportPeriod = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState(emptyForm);

  const [editingId, setEditingId] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => {
    setSalaryHistory([]); setSalaryHistoryError('');
    if (!editingId) return;
    const controller = new AbortController();
    api.get(`/employees/${editingId}/salary-history`, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setSalaryHistory(data); })
      .catch(() => { if (!controller.signal.aborted) setSalaryHistoryError('Unable to load salary history.'); });
    return () => controller.abort();
  }, [editingId]);
  const [showForm, setShowForm] = useState(false);

  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [toast, setToast] = useState(null);
  const [errors, setErrors] = useState({});

  const showToast = (message, type = 'success') => {
    setToast({
      message,
      type,
    });

    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  const loadEmployees = async () => {
    try {
      setLoading(true);

      const response = await api.get('/employees');

      setEmployees(
        Array.isArray(response.data)
          ? response.data
          : []
      );
    } catch (error) {
      console.error(error);

      showToast(
        error.response?.data?.message ||
        'Failed to load employees.',
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmployees();
  }, []);

  const filteredEmployees = useMemo(() => {
    const value = search.trim().toLowerCase();

    if (!value) {
      return employees;
    }

    return employees.filter((employee) => {
      return [
        employee.emp_code,
        employee.name,
        employee.email,
        employee.designation,
        employee.department,
      ]
        .filter(Boolean)
        .some((field) =>
          String(field)
            .toLowerCase()
            .includes(value)
        );
    });
  }, [employees, search]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setErrors({});
  };

  const closeForm = () => {
    resetForm();
    setShowForm(false);
  };

  const openCreateForm = () => {
    resetForm();
    setShowForm(true);

    setTimeout(() => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }, 50);
  };

  const openEditForm = (employee) => {
    setEditingId(employee.id);
    const joiningDate = employee.joining_date
      ? String(employee.joining_date).slice(0, 10)
      : todayStr();

    setForm({
      salary_effective_from: joiningDate,
      salary_change_reason: '',
      emp_code: employee.emp_code || '',
      name: employee.name || '',
      email: employee.email || '',
      password: '',
      require_password_change: true,
      pending_password_change: Boolean(employee.must_change_password),

      designation: employee.designation || '',
      department: employee.department || '',
      role: employee.role === 'manager' ? 'manager' : 'employee',
      manager_id: employee.manager_id ? String(employee.manager_id) : '',
      gender: employee.gender || '',

      dob: employee.dob
        ? String(employee.dob).slice(0, 10)
        : '',

      pan: employee.pan || '',
      pf_uan: employee.pf_uan || '',

      joining_date: joiningDate,

      resignation_date: employee.resignation_date
        ? String(employee.resignation_date).slice(0, 10)
        : '',

      ctc: employee.ctc ?? '',
      tax_regime: employee.tax_regime || 'old',

      // Earnings
      basic: employee.basic ?? '',
      hra: employee.hra ?? '',
      special_allowance:
        employee.special_allowance ?? '',
      lta: employee.lta ?? '',
      other_allowances:
        employee.other_allowances ?? '',

      // Deductions
      epf: employee.epf ?? '',
      professional_tax:
        employee.professional_tax ?? '',

      // Bank
      bank_name: employee.bank_name || '',
      bank_branch: employee.bank_branch || '',
      account_number:
        employee.account_number || '',

      ifsc_code: employee.ifsc_code || '',
    });

    setErrors({});
    setShowForm(true);

    setTimeout(() => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }, 50);
  };

  const validate = () => {
    const nextErrors = {};

    if (!form.emp_code.trim()) {
      nextErrors.emp_code =
        'Employee code is required.';
    }

    if (!form.name.trim()) {
      nextErrors.name =
        'Employee name is required.';
    }

    if (!form.email.trim()) {
      nextErrors.email =
        'Email is required.';
    }

    if (!editingId && !form.password.trim()) {
      nextErrors.password =
        'Temporary password is required.';
    } else if (form.password.trim() && form.password.length < 8) {
      nextErrors.password =
        'Password must be at least 8 characters.';
    }

    if (!form.designation.trim()) {
      nextErrors.designation =
        'Designation is required.';
    }

    if (!form.gender) {
      nextErrors.gender =
        'Gender is required.';
    }

    if (!form.dob) {
      nextErrors.dob =
        'Date of birth is required.';
    }

    if (!form.pan.trim()) {
      nextErrors.pan =
        'PAN is required.';
    }

    if (!form.pf_uan.trim()) {
      nextErrors.pf_uan =
        'PF UAN is required.';
    }

    if (!form.account_number.trim()) {
      nextErrors.account_number =
        'Bank account number is required.';
    }

    if (!form.ifsc_code.trim()) {
      nextErrors.ifsc_code =
        'IFSC code is required.';
    } else if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc_code.trim().toUpperCase())) {
      nextErrors.ifsc_code =
        'Enter a valid 11-character IFSC code.';
    }

    if (!form.joining_date) {
      nextErrors.joining_date =
        'Joining date is required.';
    }

    if (
      form.resignation_date &&
      form.joining_date &&
      form.resignation_date < form.joining_date
    ) {
      nextErrors.resignation_date =
        'Resignation date cannot be before joining date.';
    }

    if (
      form.ctc === '' ||
      form.ctc === null ||
      Number(form.ctc) < 0
    ) {
      nextErrors.ctc =
        'Enter a valid CTC.';
    }

    /*
     * Validate earnings
     */
    salaryKeys.forEach((key) => {
      if (
        form[key] !== '' &&
        form[key] !== null &&
        Number(form[key]) < 0
      ) {
        nextErrors[key] =
          'Cannot be negative.';
      }
    });

    /*
     * Validate deductions
     */
    deductionKeys.forEach((key) => {
      if (
        form[key] !== '' &&
        form[key] !== null &&
        Number(form[key]) < 0
      ) {
        nextErrors[key] =
          'Cannot be negative.';
      }
    });

    setErrors(nextErrors);

    return Object.keys(nextErrors).length === 0;
  };

  // Random temporary password for the administrator to hand over; shown so it can be copied.
  const generatePassword = () => {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    setForm((current) => ({
      ...current,
      password: Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join(''),
      require_password_change: true,
    }));
    setShowPassword(true);
  };

  const handleChange = (event) => {
    const { name, value } = event.target;

    if (name === 'ctc') {
      const nextCtc = value;

      setForm((previous) => {
        const nextForm = {
          ...previous,
          ctc: nextCtc,
        };

        if (
          nextCtc === '' ||
          Number(nextCtc) <= 0
        ) {
          return {
            ...nextForm,
            basic: '',
            hra: '',
            special_allowance: '',
            lta: '',
            other_allowances: '',
            epf: '',
            professional_tax: '',
          };
        }

        return {
          ...nextForm,
          ...buildSalaryFromCtc(nextCtc),
        };
      });

      if (errors[name]) {
        setErrors((previous) => ({
          ...previous,
          [name]: '',
        }));
      }

      return;
    }

    // PAN and IFSC are always uppercase letters and digits.
    const nextValue =
      name === 'pan' || name === 'ifsc_code'
        ? value.toUpperCase().replace(/[^A-Z0-9]/g, '')
        : value;

    setForm((previous) => ({
      ...previous,
      [name]: nextValue,
      ...(name === 'joining_date' ? { salary_effective_from: nextValue } : {}),
    }));

    if (errors[name]) {
      setErrors((previous) => ({
        ...previous,
        [name]: '',
      }));
    }
  };

  const buildPayload = () => {
    const payload = {
      salary_effective_from: form.salary_effective_from,
      salary_change_reason: form.salary_change_reason,
      emp_code: form.emp_code.trim(),
      name: form.name.trim(),
      email: form.email.trim(),

      designation:
        form.designation.trim(),

      department: form.department.trim(),

      role: form.role,
      manager_id: form.manager_id || null,

      gender: form.gender,
      dob: form.dob,

      pan: form.pan
        .trim()
        .toUpperCase(),

      pf_uan: form.pf_uan.trim(),

      joining_date:
        form.joining_date,

      resignation_date:
        form.resignation_date || null,

      ctc: Number(form.ctc),

      tax_regime:
        form.tax_regime,

      bank_name: String(form.bank_name ?? '').trim(),
      bank_branch: String(form.bank_branch ?? '').trim(),

      account_number:
        form.account_number.trim(),

      ifsc_code: form.ifsc_code
        .trim()
        .toUpperCase(),
    };

    /*
     * Earnings
     */
    salaryKeys.forEach((key) => {
      payload[key] =
        form[key] === '' ||
          form[key] === null
          ? 0
          : Number(form[key]);
    });

    /*
     * Deductions
     */
    deductionKeys.forEach((key) => {
      payload[key] =
        form[key] === '' ||
          form[key] === null
          ? 0
          : Number(form[key]);
    });

    /*
     * Password only when provided.
     */
    if (form.password.trim()) {
      payload.password =
        form.password;
      payload.require_password_change =
        form.require_password_change;
    }

    return payload;
  };

  /*
   * Prevent Enter from accidentally submitting
   * the employee form.
   */
  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!validate()) {
      showToast(
        'Please correct the highlighted fields.',
        'error'
      );

      return;
    }

    try {
      setSaving(true);

      const payload = buildPayload();

      if (editingId) {
        await api.put(
          `/employees/${editingId}`,
          payload
        );

        showToast(
          'Employee updated successfully.'
        );
      } else {
        await api.post(
          '/employees',
          payload
        );

        showToast(
          'Employee added successfully.'
        );
      }

      await loadEmployees();
      closeForm();
    } catch (error) {
      console.error(error);

      showToast(
        error.response?.data?.message ||
        'Failed to save employee.',
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (employee) => {
    const confirmed = window.confirm(
      `Delete employee "${employee.name}" (${employee.emp_code})?`
    );

    if (!confirmed) return;

    try {
      await api.delete(
        `/employees/${employee.id}`
      );

      showToast(
        'Employee deleted successfully.'
      );

      await loadEmployees();
    } catch (error) {
      console.error(error);

      showToast(
        error.response?.data?.message ||
        'Failed to delete employee.',
        'error'
      );
    }
  };

  const fieldClass = (fieldName) =>
    `employee-input ${errors[fieldName]
      ? 'has-error'
      : ''
    }`;

  return (
    <div className="employees-page">
      <style>{`
        .employees-page {
          width: 100%;
          min-width: 0;
          padding: 4px 0 30px;
        }

        .employees-page *,
        .employees-page *::before,
        .employees-page *::after {
          box-sizing: border-box;
        }

        .employees-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 22px;
          flex-wrap: wrap;
        }

        .employees-title-wrap {
          min-width: 0;
        }

        .employees-title {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          color: #0f172a;
          font-size: 26px;
          font-weight: 750;
          line-height: 1.2;
        }

        .employees-title-icon {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #eef2ff;
          color: #4f46e5;
          flex-shrink: 0;
        }

        .employees-subtitle {
          margin: 7px 0 0 52px;
          color: #64748b;
          font-size: 14px;
        }

        .employees-count {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 30px;
          height: 25px;
          padding: 0 9px;
          margin-left: 5px;
          border-radius: 999px;
          background: #e2e8f0;
          color: #334155;
          font-size: 12px;
          font-weight: 700;
        }

        .employee-primary-btn,
        .employee-secondary-btn {
          border: 0;
          border-radius: 10px;
          min-height: 42px;
          padding: 0 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 650;
          transition: 0.18s ease;
          white-space: nowrap;
        }

        .employee-primary-btn {
          background: #4f46e5;
          color: #fff;
          box-shadow: 0 5px 14px rgba(79, 70, 229, 0.18);
        }

        .employee-primary-btn:hover {
          background: #4338ca;
          transform: translateY(-1px);
        }

        .employee-primary-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
          transform: none;
        }

        .employee-secondary-btn {
          background: #f1f5f9;
          color: #334155;
        }

        .employee-secondary-btn:hover {
          background: #e2e8f0;
        }

        .employee-form-card,
        .employees-table-card {
          width: 100%;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          box-shadow: 0 4px 18px rgba(15, 23, 42, 0.045);
        }

        .employee-form-card {
          margin-bottom: 22px;
          overflow: hidden;
        }

        .employee-form-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 22px;
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
        }

        .employee-form-title {
          margin: 0;
          font-size: 17px;
          color: #0f172a;
          font-weight: 700;
        }

        .employee-form-subtitle {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .employee-form-body {
          padding: 22px;
        }

        .employee-section {
          padding: 0 0 22px;
          margin-bottom: 22px;
          border-bottom: 1px solid #e2e8f0;
        }

        .employee-section:last-child {
          margin-bottom: 0;
          padding-bottom: 0;
          border-bottom: 0;
        }

        .employee-section-header {
          display: flex;
          align-items: center;
          gap: 11px;
          margin-bottom: 18px;
        }

        .employee-section-icon {
          width: 36px;
          height: 36px;
          border-radius: 9px;
          background: #eef2ff;
          color: #4f46e5;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .employee-section-header h3 {
          margin: 0;
          font-size: 15px;
          color: #0f172a;
        }

        .employee-section-header p {
          margin: 3px 0 0;
          color: #64748b;
          font-size: 12px;
        }

        .employee-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        .employee-field {
          min-width: 0;
        }

        .employee-field.full {
          grid-column: 1 / -1;
        }

        .employee-label {
          display: block;
          margin-bottom: 7px;
          color: #334155;
          font-size: 12px;
          font-weight: 650;
        }

        .employee-required {
          color: #dc2626;
        }

        .employee-input,
        .employee-select {
          width: 100%;
          min-height: 42px;
          border: 1px solid #cbd5e1;
          border-radius: 9px;
          padding: 0 12px;
          outline: none;
          background: #fff;
          color: #0f172a;
          font-size: 14px;
          transition: 0.18s ease;
        }

        .employee-input:focus,
        .employee-select:focus {
          border-color: #4f46e5;
          box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.10);
        }

        .employee-input.has-error,
        .employee-select.has-error {
          border-color: #ef4444;
          background: #fffafa;
        }

        .employee-error {
          margin-top: 5px;
          color: #dc2626;
          font-size: 11px;
        }

        .employee-help {
          margin-top: 5px;
          color: #94a3b8;
          font-size: 11px;
        }

        .employee-form-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          padding-top: 20px;
          margin-top: 20px;
          border-top: 1px solid #e2e8f0;
        }

        .employees-table-card {
          overflow: hidden;
        }

        .employees-table-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 20px;
          border-bottom: 1px solid #e2e8f0;
          flex-wrap: wrap;
        }

        .employees-table-title {
          display: flex;
          align-items: center;
          gap: 9px;
          color: #0f172a;
          font-size: 16px;
          font-weight: 700;
        }

        .employees-table-title svg {
          color: #4f46e5;
        }

        .employee-search {
          width: min(340px, 100%);
          position: relative;
        }

        .employee-search-icon {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
          pointer-events: none;
        }

        .employee-search input {
          width: 100%;
          height: 40px;
          border: 1px solid #cbd5e1;
          border-radius: 9px;
          padding: 0 12px 0 37px;
          outline: none;
          color: #0f172a;
          background: #fff;
        }

        .employee-search input:focus {
          border-color: #4f46e5;
          box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.10);
        }

        .employee-table-wrapper {
          width: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
        }

        .employee-table {
          width: 100%;
          min-width: 920px;
          border-collapse: collapse;
          table-layout: fixed;
        }

        .employee-table th {
          padding: 13px 14px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          color: #475569;
          font-size: 11px;
          font-weight: 750;
          text-transform: uppercase;
          letter-spacing: 0.035em;
          text-align: left;
          white-space: nowrap;
        }

        .employee-table td {
          padding: 14px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
          font-size: 13px;
          vertical-align: middle;
          overflow: hidden;
        }

        .employee-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .employee-table tbody tr:hover {
          background: #f8fafc;
        }

        .employee-table th:nth-child(1),
        .employee-table td:nth-child(1) {
          width: 80px;
        }

        .employee-table th:nth-child(2),
        .employee-table td:nth-child(2) {
          width: 16%;
        }

        .employee-table th:nth-child(3),
        .employee-table td:nth-child(3) {
          width: 16%;
        }

        .employee-table th:nth-child(4),
        .employee-table td:nth-child(4) {
          width: 15%;
        }

        .employee-table th:nth-child(5),
        .employee-table td:nth-child(5) {
          width: 13%;
        }

        .employee-table th:nth-child(6),
        .employee-table td:nth-child(6) {
          width: 10%;
        }

        .employee-table th:nth-child(7),
        .employee-table td:nth-child(7) {
          width: 190px;
        }

        .employee-table th:nth-child(7) {
          position: sticky;
          right: 0;
          z-index: 2;
          background: #f8fafc;
        }

        .employee-table td:nth-child(7) {
          position: sticky;
          right: 0;
          z-index: 1;
          background: #fff;
        }

        .employee-id {
          color: #64748b;
          font-weight: 600;
        }

        .employee-name-cell {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .employee-avatar {
          width: 34px;
          height: 34px;
          flex: 0 0 34px;
          border-radius: 9px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #eef2ff;
          color: #4f46e5;
        }

        .employee-name-content {
          min-width: 0;
        }

        .employee-name {
          color: #0f172a;
          font-weight: 700;
          text-decoration: none;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .employee-name:hover {
          color: #305ceb;
          text-decoration: underline;
        }

        .employee-code {
          margin-top: 2px;
          color: #94a3b8;
          font-size: 11px;
        }

        .employee-email {
          display: block;
          max-width: 100%;
          color: #475569;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .employee-designation {
          color: #334155;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .employee-ctc {
          color: #0f172a;
          font-weight: 700;
          white-space: nowrap;
        }

        .employee-actions {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 7px;
          width: 100%;
          white-space: nowrap;
        }

        .employee-action-btn {
          min-height: 34px;
          padding: 0 10px;
          border-radius: 8px;
          border: 1px solid;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 650;
          transition: 0.18s ease;
          white-space: nowrap;
        }

        .employee-edit-btn {
          color: #4f46e5;
          background: #eef2ff;
          border-color: #c7d2fe;
        }

        .employee-edit-btn:hover {
          background: #e0e7ff;
          border-color: #a5b4fc;
        }

        .employee-delete-btn {
          color: #dc2626;
          background: #fef2f2;
          border-color: #fecaca;
        }

        .employee-delete-btn:hover {
          background: #fee2e2;
          border-color: #fca5a5;
        }

        .employee-empty {
          padding: 50px 20px;
          text-align: center;
          color: #64748b;
        }

        .employee-empty-icon {
          width: 46px;
          height: 46px;
          margin: 0 auto 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          background: #f1f5f9;
          color: #64748b;
        }

        .employee-empty-title {
          color: #334155;
          font-weight: 700;
          margin-bottom: 5px;
        }

        .employee-empty-text {
          font-size: 13px;
        }

        .employee-loading {
          padding: 45px 20px;
          text-align: center;
          color: #64748b;
        }

        .employee-loading-spinner {
          width: 25px;
          height: 25px;
          margin: 0 auto 10px;
          border: 3px solid #e2e8f0;
          border-top-color: #4f46e5;
          border-radius: 50%;
          animation: employeeSpin 0.8s linear infinite;
        }

        @keyframes employeeSpin {
          to {
            transform: rotate(360deg);
          }
        }

        .employee-toast {
          position: fixed;
          right: 22px;
          bottom: 22px;
          z-index: 9999;
          min-width: 300px;
          max-width: calc(100vw - 40px);
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 13px 14px;
          border-radius: 11px;
          background: #fff;
          border: 1px solid #e2e8f0;
          box-shadow: 0 15px 35px rgba(15, 23, 42, 0.15);
        }

        .employee-toast.success {
          border-left: 4px solid #16a34a;
        }

        .employee-toast.error {
          border-left: 4px solid #dc2626;
        }

        .employee-toast-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          flex-shrink: 0;
        }

        .employee-toast.success .employee-toast-icon {
          color: #16a34a;
        }

        .employee-toast.error .employee-toast-icon {
          color: #dc2626;
        }

        .employee-toast-message {
          flex: 1;
          color: #334155;
          font-size: 13px;
          line-height: 1.4;
        }

        .employee-toast-close {
          width: 28px;
          height: 28px;
          border: 0;
          background: transparent;
          color: #94a3b8;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 7px;
          cursor: pointer;
          flex-shrink: 0;
        }

        .employee-toast-close:hover {
          background: #f1f5f9;
          color: #334155;
        }

        @media (max-width: 900px) {
          .employee-table {
            min-width: 850px;
          }

          .employee-table th:nth-child(7),
          .employee-table td:nth-child(7) {
            width: 190px;
          }

          .employee-action-btn {
            padding: 0 8px;
          }
        }

        @media (max-width: 720px) {
          .employees-page {
            padding-top: 0;
          }

          /* Phones: each employee becomes a card instead of a sideways-scrolling table row */
          .employee-table {
            min-width: 0 !important;
            table-layout: auto !important;
          }

          .employee-table thead {
            display: none;
          }

          .employee-table tbody tr {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 4px 12px;
            align-items: center;
            padding: 14px 16px;
            border-bottom: 1px solid #e2e8f0;
          }

          .employee-table td {
            display: block;
            width: auto !important;
            padding: 0 !important;
            border: 0 !important;
          }

          .employee-table td:nth-child(1):not([colspan]) {
            display: none;
          }

          .employee-table td[colspan],
          .employee-table td:nth-child(3),
          .employee-table td:nth-child(4) {
            grid-column: 1 / -1;
          }

          .employee-table td:nth-child(2) {
            grid-column: 1;
            min-width: 0;
          }

          .employee-table td:nth-child(7) {
            grid-column: 2;
            grid-row: 1;
            justify-self: end;
            position: static;
          }

          .employee-table td:nth-child(3),
          .employee-table td:nth-child(4) {
            color: #64748b;
            font-size: 13px;
          }

          .employee-table td:nth-child(5) {
            margin-top: 6px;
          }

          .employee-table td:nth-child(6) {
            margin-top: 6px;
            justify-self: end;
          }

          .employee-name {
            white-space: normal;
            overflow: visible;
          }

          .employees-header {
            align-items: stretch;
          }

          .employees-title {
            font-size: 22px;
          }

          .employees-title-icon {
            width: 38px;
            height: 38px;
          }

          .employees-subtitle {
            margin-left: 48px;
          }

          .employees-header > button {
            width: 100%;
          }

          .employee-form-top {
            align-items: flex-start;
          }

          .employee-form-body {
            padding: 16px;
          }

          .employee-form-grid {
            grid-template-columns: 1fr;
          }

          .employee-field.full {
            grid-column: auto;
          }

          .employee-form-actions {
            flex-direction: column-reverse;
          }

          .employee-form-actions button {
            width: 100%;
          }

          .employees-table-toolbar {
            align-items: stretch;
          }

          .employee-search {
            width: 100%;
          }

          .employee-toast {
            left: 15px;
            right: 15px;
            bottom: 15px;
            min-width: 0;
          }
        }
      `}</style>

      <Toast
        toast={toast}
        onClose={() => setToast(null)}
      />

      {/* PAGE HEADER */}
      <div className="employees-header">
        <div className="employees-title-wrap">
          <h1 className="employees-title">
            <span className="employees-title-icon">
              <FiUsers size={21} />
            </span>

            Employees

            <span className="employees-count">
              {employees.length}
            </span>
          </h1>

          <p className="employees-subtitle">
            Manage employee profiles, salary details and bank information.
          </p>
        </div>

        {!showForm && (
          <button
            type="button"
            className="employee-primary-btn"
            onClick={openCreateForm}
          >
            <FiPlus size={17} />
            Add Employee
          </button>
        )}
      </div>

      {/* CREATE / EDIT FORM */}
      {showForm && (
        <form
          className="employee-form-card"
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
        >
          <div className="employee-form-top">
            <div>
              <h2 className="employee-form-title">
                {editingId
                  ? 'Edit Employee'
                  : 'Add New Employee'}
              </h2>

              <p className="employee-form-subtitle">
                {editingId
                  ? 'Update the employee information below.'
                  : 'Enter the employee details to create a new profile.'}
              </p>
            </div>
          </div>

          <div className="employee-form-body">

            {/* BASIC DETAILS */}
            <div className="employee-section">
              <SectionHeader
                icon={<FiUser size={18} />}
                title="Basic Details"
                description="Personal and login information"
              />

              <div className="employee-form-grid">

                <div className="employee-field">
                  <label className="employee-label">
                    Employee Code{' '}
                    <span className="employee-required">
                      *
                    </span>
                  </label>

                  <input
                    name="emp_code"
                    value={form.emp_code}
                    onChange={handleChange}
                    className={fieldClass('emp_code')}
                    placeholder="EMP001"
                  />

                  {errors.emp_code && (
                    <div className="employee-error">
                      {errors.emp_code}
                    </div>
                  )}
                </div>

                <div className="employee-field">
                  <label className="employee-label">
                    Employee Name{' '}
                    <span className="employee-required">
                      *
                    </span>
                  </label>

                  <input
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    className={fieldClass('name')}
                    placeholder="Full name"
                  />

                  {errors.name && (
                    <div className="employee-error">
                      {errors.name}
                    </div>
                  )}
                </div>

                <div className="employee-field">
                  <label className="employee-label">
                    Email{' '}
                    <span className="employee-required">
                      *
                    </span>
                  </label>

                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    className={fieldClass('email')}
                    placeholder="employee@company.com"
                  />

                  {errors.email && (
                    <div className="employee-error">
                      {errors.email}
                    </div>
                  )}
                </div>

                <div className="employee-field">
                  <label className="employee-label">
                    {editingId
                      ? 'Reset password'
                      : 'Temporary password *'}
                  </label>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      value={form.password}
                      onChange={handleChange}
                      className={fieldClass('password')}
                      autoComplete="new-password"
                      style={{ flex: 1 }}
                      placeholder={
                        editingId
                          ? 'Leave blank to keep current password'
                          : 'At least 8 characters'
                      }
                    />
                    <button type="button" className="employee-secondary-btn" onClick={generatePassword}>Generate</button>
                    <button type="button" className="employee-secondary-btn" onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Hide' : 'Show'}</button>
                  </div>

                  {editingId && (
                    <div className="employee-help">
                      Leave blank to keep the existing password.
                      {form.pending_password_change && ' This employee has not yet replaced their temporary password.'}
                    </div>
                  )}

                  {form.password.trim() && (
                    <label className="employee-help" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                      <input
                        type="checkbox"
                        checked={form.require_password_change}
                        onChange={(event) => setForm((current) => ({ ...current, require_password_change: event.target.checked }))}
                      />
                      Require the employee to set their own password at next sign-in
                    </label>
                  )}

                  {errors.password && (
                    <div className="employee-error">
                      {errors.password}
                    </div>
                  )}
                </div>

                <div className="employee-field">
                  <label className="employee-label">
                    Designation{' '}
                    <span className="employee-required">
                      *
                    </span>
                  </label>

                  <input
                    name="designation"
                    value={form.designation}
                    onChange={handleChange}
                    className={fieldClass('designation')}
                    placeholder="Software Engineer"
                  />

                  {errors.designation && (
                    <div className="employee-error">
                      {errors.designation}
                    </div>
                  )}
                </div>

                <div className="employee-field">
                  <label className="employee-label">
                    Department
                  </label>

                  <input
                    name="department"
                    value={form.department}
                    onChange={handleChange}
                    className={fieldClass('department')}
                    placeholder="Engineering"
                  />
                </div>

                <div className="employee-field">
                  <label className="employee-label">Role</label>
                  <select name="role" value={form.role} onChange={handleChange} className="employee-select">
                    <option value="employee">Employee</option>
                    <option value="manager">Manager (approves team leave)</option>
                  </select>
                </div>

                <div className="employee-field">
                  <label className="employee-label">Reports to</label>
                  <select name="manager_id" value={form.manager_id} onChange={handleChange} className="employee-select">
                    <option value="">No manager (admin approves leave)</option>
                    {employees
                      .filter((person) => person.role === 'manager' && person.is_active !== false && person.id !== editingId)
                      .map((person) => <option key={person.id} value={person.id}>{person.name} ({person.emp_code})</option>)}
                  </select>
                </div>

                <div className="employee-field">
                  <label className="employee-label">
                    Gender{' '}
                    <span className="employee-required">
                      *
                    </span>
                  </label>

                  <select
                    name="gender"
                    value={form.gender}
                    onChange={handleChange}
                    className={`employee-select ${errors.gender
                      ? 'has-error'
                      : ''
                      }`}
                  >
                    <option value="">
                      Select gender
                    </option>

                    <option value="male">
                      Male
                    </option>

                    <option value="female">
                      Female
                    </option>

                    <option value="other">
                      Other
                    </option>
                  </select>

                  {errors.gender && (
                    <div className="employee-error">
                      {errors.gender}
                    </div>
                  )}
                </div>

                <div className="employee-field">
                  <label className="employee-label">
                    Date of Birth{' '}
                    <span className="employee-required">
                      *
                    </span>
                  </label>

                  <input
                    type="date"
                    name="dob"
                    value={form.dob}
                    onChange={handleChange}
                    className={fieldClass('dob')}
                  />

                  {errors.dob && (
                    <div className="employee-error">
                      {errors.dob}
                    </div>
                  )}
                </div>

                <div className="employee-field">
                  <label className="employee-label">
                    PAN (Permanent Account Number){' '}
                    <span className="employee-required">
                      *
                    </span>
                  </label>

                  <input
                    name="pan"
                    value={form.pan}
                    onChange={handleChange}
                    className={fieldClass('pan')}
                    placeholder="ABCDE1234F"
                    maxLength={10}
                    autoCapitalize="characters"
                    spellCheck={false}
                    style={{ textTransform: 'uppercase' }}
                  />

                  {errors.pan && (
                    <div className="employee-error">
                      {errors.pan}
                    </div>
                  )}
                </div>

                <div className="employee-field">
                  <label className="employee-label">
                    PF UAN (Provident Fund Universal Account Number){' '}
                    <span className="employee-required">
                      *
                    </span>
                  </label>

                  <input
                    name="pf_uan"
                    value={form.pf_uan}
                    onChange={handleChange}
                    className={fieldClass('pf_uan')}
                    placeholder="12 digit UAN"
                  />

                  {errors.pf_uan && (
                    <div className="employee-error">
                      {errors.pf_uan}
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* EMPLOYMENT DATES */}
            <div className="employee-section">
              <SectionHeader
                icon={<FiCalendar size={18} />}
                title="Employment Dates"
                description="Joining and resignation information"
              />

              <div className="employee-form-grid">

                <div className="employee-field">
                  <label className="employee-label">
                    Joining Date{' '}
                    <span className="employee-required">
                      *
                    </span>
                  </label>

                  <input
                    type="date"
                    name="joining_date"
                    value={form.joining_date}
                    onChange={handleChange}
                    className={fieldClass('joining_date')}
                  />

                  {errors.joining_date && (
                    <div className="employee-error">
                      {errors.joining_date}
                    </div>
                  )}
                </div>

                <div className="employee-field">
                  <label className="employee-label">
                    Resignation Date
                  </label>

                  <input
                    type="date"
                    name="resignation_date"
                    value={form.resignation_date}
                    onChange={handleChange}
                    className={fieldClass('resignation_date')}
                  />

                  {errors.resignation_date && (
                    <div className="employee-error">
                      {errors.resignation_date}
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* SALARY & TAX */}
            <div className="employee-section">
              <SectionHeader
                icon={<FaRupeeSign size={18} />}
                title="Salary & Tax"
                description="Cost to Company and monthly salary structure"
              />

              <div className="employee-form-grid">

                <div className="employee-field">
                  <label className="employee-label">
                    Annual CTC (Cost to Company){' '}
                    <span className="employee-required">
                      *
                    </span>
                  </label>

                  <input step="any"
                    type="number"
                    min="0"
                    name="ctc"
                    value={form.ctc}
                    onChange={handleChange}
                    className={fieldClass('ctc')}
                    placeholder="600000"
                  />

                  {errors.ctc && (
                    <div className="employee-error">
                      {errors.ctc}
                    </div>
                  )}
                </div>

                <div className="employee-field">
                  <label className="employee-label">
                    Tax Regime
                  </label>

                  <select
                    name="tax_regime"
                    value={form.tax_regime}
                    onChange={handleChange}
                    className="employee-select"
                  >
                    <option value="new">
                      New Regime
                    </option>

                    <option value="old">
                      Old Regime
                    </option>

                  </select>
                </div>

              </div>

              <div style={{ height: 22 }} />

              {/* MONTHLY SALARY STRUCTURE */}
              {editingId && <div className="payroll-salary-history">
                <div className="employee-form-grid"><div className="employee-field"><label className="employee-label">Salary effective from<input type="date" min="2000-01-01" max="2100-12-31" name="salary_effective_from" value={form.salary_effective_from} onChange={handleChange} className="employee-input" /></label></div><div className="employee-field"><label className="employee-label">Salary change reason<input type="text" maxLength={1000} name="salary_change_reason" value={form.salary_change_reason} onChange={handleChange} className="employee-input" placeholder="Required when salary components change" required={false} /></label></div></div>
                <p className="employee-help">Defaults to the employee's joining date. For a later salary revision, select the date the new salary actually takes effect.</p>
                <details><summary>Salary history ({salaryHistory.length} version{salaryHistory.length === 1 ? '' : 's'})</summary>{salaryHistoryError ? <p role="alert">{salaryHistoryError}</p> : <div className="employee-table-wrapper"><table><thead><tr><th>Effective from</th><th>Monthly earnings</th><th>Changed by / reason</th></tr></thead><tbody>{salaryHistory.map((version) => <tr key={version.id}><td>{version.effective_from}</td><td>{money(salaryKeys.reduce((sum, key) => sum + Number(version[key] || 0), 0))}</td><td>{version.changed_by}<div>{version.reason}</div></td></tr>)}</tbody></table></div>}</details>
              </div>}
              <SectionHeader
                icon={<FaRupeeSign size={18} />}
                title="Monthly Salary Structure (Earnings)"
                description="Enter the employee's monthly earnings"
              />

              <div className="employee-form-grid">

                {salaryKeys.map((key) => (
                  <div
                    className="employee-field"
                    key={key}
                  >
                    <label className="employee-label">
                      {salaryLabels[key]}
                    </label>

                    <input
                      type="number"
                      min="0"
                      step="any"
                      name={key}
                      value={form[key]}
                      onChange={handleChange}
                      className={fieldClass(key)}
                      placeholder="0"
                    />

                    {errors[key] && (
                      <div className="employee-error">
                        {errors[key]}
                      </div>
                    )}
                  </div>
                ))}

              </div>
            </div>

            {/* DEDUCTIONS */}
            <div className="employee-section">
              <SectionHeader
                icon={<FaRupeeSign size={18} />}
                title="Deductions"
                description="Enter the employee's monthly salary deductions"
              />

              <div className="employee-form-grid">

                {deductionKeys.map((key) => (
                  <div
                    className="employee-field"
                    key={key}
                  >
                    <label className="employee-label">
                      {deductionLabels[key]}
                    </label>

                    <input
                      type="number"
                      min="0"
                      step="any"
                      name={key}
                      value={form[key]}
                      onChange={handleChange}
                      className={fieldClass(key)}
                      placeholder="0"
                    />

                    {errors[key] && (
                      <div className="employee-error">
                        {errors[key]}
                      </div>
                    )}
                  </div>
                ))}

              </div>
            </div>

            {/* BANK DETAILS */}
            <div className="employee-section">
              <SectionHeader
                icon={<FiCreditCard size={18} />}
                title="Bank Details"
                description="Enter the bank branch details matching the employee's salary account"
              />

              <div className="employee-form-grid">

                <div className="employee-field">
                  <label className="employee-label">
                    Bank Name
                  </label>

                  <input
                    name="bank_name"
                    value={form.bank_name ?? ''}
                    onChange={handleChange}
                    className={fieldClass('bank_name')}
                    placeholder="e.g. State Bank of India"
                    autoComplete="off"
                  />
                </div>

                <div className="employee-field">
                  <label className="employee-label">
                    Branch Name
                  </label>

                  <input
                    name="bank_branch"
                    value={form.bank_branch ?? ''}
                    onChange={handleChange}
                    className={fieldClass('bank_branch')}
                    placeholder="Bank branch"
                    autoComplete="off"
                  />
                </div>

                <div className="employee-field">
                  <label className="employee-label">
                    Account Number{' '}
                    <span className="employee-required">
                      *
                    </span>
                  </label>

                  <input
                    name="account_number"
                    value={form.account_number}
                    onChange={handleChange}
                    className={fieldClass(
                      'account_number'
                    )}
                    placeholder="Bank account number"
                  />

                  {errors.account_number && (
                    <div className="employee-error">
                      {errors.account_number}
                    </div>
                  )}
                </div>

                <div className="employee-field">
                  <label className="employee-label">
                    IFSC Code (Indian Financial System Code){' '}
                    <span className="employee-required">
                      *
                    </span>
                  </label>

                  <input
                    name="ifsc_code"
                    value={form.ifsc_code}
                    onChange={handleChange}
                    className={fieldClass(
                      'ifsc_code'
                    )}
                    placeholder="SBIN0001234"
                    maxLength={11}
                    autoCapitalize="characters"
                    spellCheck={false}
                    style={{ textTransform: 'uppercase' }}
                  />

                  <div className="employee-help">
                    IFSC identifies a bank branch, not just the bank. Verify the code against the account's branch.
                  </div>

                  {errors.ifsc_code && (
                    <div className="employee-error">
                      {errors.ifsc_code}
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* FORM ACTIONS */}
            <div className="employee-form-actions">

              <button
                type="button"
                className="employee-secondary-btn"
                onClick={closeForm}
                disabled={saving}
              >
                <FiX size={16} />
                Cancel
              </button>

              <button
                type="submit"
                className="employee-primary-btn"
                disabled={saving}
              >
                <FiSave size={16} />

                {saving
                  ? 'Saving...'
                  : editingId
                    ? 'Update Employee'
                    : 'Save Employee'}
              </button>

            </div>

          </div>
        </form>
      )}

      {/* EMPLOYEE TABLE */}
      {!showForm && <div className="employees-table-card">

        <div className="employees-table-toolbar">

          <div className="employees-table-title">
            <FiUsers size={18} />
            Employee List
          </div>

          <div className="employee-search">

            <FiSearch
              className="employee-search-icon"
              size={17}
            />

            <input
              type="text"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search by name, code, email..."
            />

          </div>

        </div>

        <div className="employee-table-wrapper">

          <table className="employee-table">

            <thead>
              <tr>
                {/* <th>ID</th> */}
                <th>Employee ID</th>
                <th>Employee</th>
                <th>Email</th>
                <th>Designation</th>
                <th>Department</th>
                <th>Annual CTC</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>

              {loading ? (
                <tr>
                  <td colSpan="7">

                    <div className="employee-loading">

                      <div className="employee-loading-spinner" />

                      Loading employees...

                    </div>

                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan="7">

                    <div className="employee-empty">

                      <div className="employee-empty-icon">
                        <FiUsers size={22} />
                      </div>

                      <div className="employee-empty-title">
                        No employees found
                      </div>

                      <div className="employee-empty-text">
                        {search
                          ? 'Try changing your search.'
                          : 'Add your first employee to get started.'}
                      </div>

                    </div>

                  </td>
                </tr>
              ) : (
                [...filteredEmployees]
                  .sort((a, b) =>
                    String(a.emp_code || '').localeCompare(
                      String(b.emp_code || ''),
                      undefined,
                      { numeric: true }
                    )
                  )
                  .map((employee) => (
                    <tr key={employee.id}>

                      <td>
                        <Link className="employee-id" to={`/admin/reports/employees/${employee.id}?period=${reportPeriod}`} title={`Open monthly report for ${employee.name || 'employee'}`}>
                          {employee.emp_code || '-'}
                        </Link>
                      </td>

                      <td>
                        <div className="employee-name-cell">

                          <div className="employee-avatar">
                            <FiUser size={16} />
                          </div>

                          <div className="employee-name-content">

                            <Link className="employee-name" to={`/admin/reports/employees/${employee.id}?period=${reportPeriod}`} title={`Open monthly report for ${employee.name || 'employee'}`}>
                              {employee.name || '-'}
                            </Link>

                            <div className="employee-code">
                              {employee.emp_code || '-'}
                            </div>

                          </div>

                        </div>
                      </td>

                      <td>
                        <span
                          className="employee-email"
                          title={employee.email || ''}
                        >
                          {employee.email || '-'}
                        </span>
                      </td>

                      <td>
                        <span
                          className="employee-designation"
                          title={employee.designation || ''}
                        >
                          {employee.designation || '-'}
                        </span>
                      </td>

                      <td>
                        <span
                          className="employee-designation"
                          title={employee.department || ''}
                        >
                          {employee.department || '-'}
                        </span>
                      </td>

                      <td>
                        <span className="employee-ctc">
                          {money(employee.ctc)}
                        </span>
                      </td>

                      <td>
                        <div className="employee-actions">

                          <button
                            type="button"
                            className="employee-action-btn employee-edit-btn"
                            onClick={() => openEditForm(employee)}
                            title={`Edit ${employee.name || 'employee'}`}
                            aria-label={`Edit ${employee.name || 'employee'}`}
                          >
                            <FiEdit2 size={14} />
                            <span>Edit</span>
                          </button>

                          <button
                            type="button"
                            className="employee-action-btn employee-delete-btn"
                            onClick={() => handleDelete(employee)}
                            title={`Delete ${employee.name || 'employee'}`}
                            aria-label={`Delete ${employee.name || 'employee'}`}
                          >
                            <FiTrash2 size={14} />
                            <span>Delete</span>
                          </button>

                        </div>
                      </td>

                    </tr>
                  ))
              )
              }

            </tbody>

          </table>

        </div>
      </div>}


    </div>
  );
}
