import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiCheckCircle, FiClock, FiEdit3, FiEye, FiSend, FiUsers } from 'react-icons/fi';
import api from '../../api';
import { EmptyState, Skeleton, StatCard } from '../../components/ui';
import './Team.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const money = (value) => Number(value || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
const EARNINGS = ['basic', 'hra', 'special_allowance', 'lta', 'other_allowances', 'allowances'];

// One plain-language state per payslip, following Draft -> Submitted -> Approved -> Published.
function stage(row) {
  if (!row.payslip_id) return ['Not calculated', ''];
  if (row.published) return ['Published', 'ok'];
  if (row.payroll_status === 'finalized') return ['Approved - ready to publish', 'ok'];
  if (row.payroll_status === 'submitted') return ['Awaiting admin approval', 'warn'];
  if (row.payroll_status === 'reviewed') return ['In admin review', 'warn'];
  return ['Draft', ''];
}

export default function TeamPayroll() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [checklist, setChecklist] = useState(null);
  const [slips, setSlips] = useState([]);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, payslips] = await Promise.all([
        api.get('/payslips/checklist', { params: { month, year } }),
        api.get('/payslips', { params: { month, year } }),
      ]);
      setChecklist(list.data);
      setSlips(payslips.data);
    } catch (err) {
      setMessage({ error: err.response?.data?.message || 'Unable to load team payroll.' });
    } finally {
      setLoading(false);
    }
  }, [month, year]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (checklist?.employees || []).map((row) => ({
    ...row, slip: slips.find((slip) => slip.employee_id === row.employee_id),
  })), [checklist, slips]);

  const counts = useMemo(() => ({
    toCalculate: rows.filter((row) => !row.payslip_id && !row.missing_salary).length,
    drafts: rows.filter((row) => row.payroll_status === 'draft').length,
    submitted: rows.filter((row) => row.payroll_status === 'submitted').length,
    toPublish: rows.filter((row) => row.payroll_status === 'finalized' && !row.published).length,
    published: rows.filter((row) => row.published).length,
  }), [rows]);

  async function run(label, request, success) {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await request();
      setMessage({ ok: success(data), warnings: [...(data.warnings || []).map((w) => `${w.name}: ${w.message}`), ...(data.skipped || []).map((s) => `${s.name}: ${s.message}`)] });
      await load();
    } catch (err) {
      setMessage({ error: err.response?.data?.message || `Unable to ${label}.` });
    } finally {
      setBusy(false);
    }
  }

  const period = { month, year };
  const calculate = (mode, employeeId) => run('calculate payroll', () => api.post('/payslips/generate', { ...period, mode, ...(employeeId ? { employee_id: employeeId } : {}) }), (data) => data.message);
  const submitAll = () => run('submit payroll', () => api.post('/payslips/submit', period), (data) => `${data.count} payslip${data.count === 1 ? '' : 's'} submitted for admin approval.`);
  const publishAll = () => run('publish payslips', () => api.post('/payslips/publish', period), (data) => `${data.count} payslip${data.count === 1 ? '' : 's'} published to employees.`);
  const submitOne = (row) => run('submit payroll', () => api.patch(`/payslips/${row.payslip_id}/submit`), () => `${row.name}'s payroll was submitted for admin approval.`);
  const publishOne = (row) => run('publish payslip', () => api.patch(`/payslips/${row.payslip_id}/publish`), () => `${row.name}'s payslip is now visible to the employee.`);

  return (
    <div className="team-page">
      <div className="team-head">
        <div>
          <h1>Team payroll</h1>
          <p className="team-sub">Calculate your team's payroll, send it to an administrator for approval, then publish the approved payslips to employees.</p>
        </div>
        <div className="team-controls">
          <select aria-label="Month" value={month} onChange={(event) => setMonth(Number(event.target.value))}>
            {MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
          </select>
          <input aria-label="Year" type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(Number(event.target.value))} style={{ width: 90 }} />
        </div>
      </div>

      <div className="team-stats" data-count="5">
        <StatCard icon={FiEdit3} tone="blue" label="1. To calculate" value={counts.toCalculate} />
        <StatCard icon={FiSend} tone="blue" label="2. Drafts to submit" value={counts.drafts} alert={counts.drafts > 0} />
        <StatCard icon={FiClock} tone="amber" label="3. Awaiting admin approval" value={counts.submitted} />
        <StatCard icon={FiCheckCircle} tone="green" label="4. Approved, ready to publish" value={counts.toPublish} alert={counts.toPublish > 0} />
        <StatCard icon={FiEye} tone="purple" label="Published to employees" value={counts.published} />
      </div>

      {message?.error && <p className="team-msg error" role="alert">{message.error}</p>}
      {message?.ok && <p className="team-msg ok" role="status">{message.ok}</p>}
      {message?.warnings?.length > 0 && <ul className="team-msg error" role="status">{message.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}

      <div className="team-actions">
        <button className="team-btn primary" type="button" disabled={busy || !counts.toCalculate} onClick={() => calculate('generate')}>Calculate payroll ({counts.toCalculate})</button>
        <button className="team-btn" type="button" disabled={busy || !counts.drafts} onClick={() => calculate('update')}>Recalculate drafts</button>
        <button className="team-btn primary" type="button" disabled={busy || !counts.drafts} onClick={submitAll}>Submit drafts for approval ({counts.drafts})</button>
        <button className="team-btn primary" type="button" disabled={busy || !counts.toPublish} onClick={publishAll}>Publish approved payslips ({counts.toPublish})</button>
      </div>

      <section className="team-card">
        <h2>{MONTHS[month - 1]} {year}</h2>
        {loading ? <Skeleton rows={5} /> : rows.length === 0 ? <EmptyState icon={FiUsers} title="No one to pay this month">No team members are eligible for payroll in the selected month.</EmptyState> : (
          <div className="team-scroll"><table>
            <thead><tr><th>Employee</th><th>Review before calculating</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Take-home</th><th>Status</th><th className="num">Action</th></tr></thead>
            <tbody>{rows.map((row) => {
              const [label, tone] = stage(row);
              const slip = row.slip;
              const gross = slip ? EARNINGS.reduce((sum, key) => sum + Number(slip[key] || 0), 0) : null;
              const items = [row.missing_salary && 'Missing salary', row.pending_leaves > 0 && `${row.pending_leaves} pending leave`, row.missing_attendance > 0 && `${row.missing_attendance} attendance gaps`, row.missing_punches > 0 && `${row.missing_punches} punches to check`].filter(Boolean);
              return (
                <tr key={row.employee_id}>
                  <td>{row.name}<div className="team-sub">{row.emp_code}</div></td>
                  <td>{items.length ? <span className="team-badge warn">{items.join(' · ')}</span> : <span className="team-sub">All clear</span>}</td>
                  <td className="num">{slip ? money(gross) : <span className="team-muted">—</span>}</td>
                  <td className="num">{slip ? money(gross - Number(slip.net_pay)) : <span className="team-muted">—</span>}</td>
                  <td className="num">{slip ? <strong>{money(slip.net_pay)}</strong> : <span className="team-muted">—</span>}</td>
                  <td><span className={`team-badge ${tone}`}>{label}</span></td>
                  <td><div className="team-actions end">
                    {!row.payslip_id && !row.missing_salary && <button className="team-btn" type="button" disabled={busy} onClick={() => calculate('generate', row.employee_id)}>Calculate</button>}
                    {row.payroll_status === 'draft' && <>
                      <button className="team-btn" type="button" disabled={busy} onClick={() => calculate('update', row.employee_id)}>Recalculate</button>
                      <button className="team-btn primary" type="button" disabled={busy || row.pending_leaves > 0} title={row.pending_leaves > 0 ? 'Decide pending leave first' : undefined} onClick={() => submitOne(row)}>Submit</button>
                    </>}
                    {row.payroll_status === 'finalized' && !row.published && <button className="team-btn primary" type="button" disabled={busy} onClick={() => publishOne(row)}>Publish</button>}
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        <p className="team-empty">Resolve pending leave and review attendance gaps first; payroll uses the attendance and approved leave you have recorded. Only an administrator can approve payroll or record payments. Once approved, publishing releases the payslip to the employee; an administrator reopening a payslip withdraws it.</p>
      </section>
    </div>
  );
}
