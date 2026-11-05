import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiCheck, FiChevronDown, FiPlus, FiRefreshCw, FiX } from 'react-icons/fi';
import api from '../api';
import './AdvancesPage.css';

const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value || 0));
const currentMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
const monthName = (value) => new Date(`${value.slice(0, 7)}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
const statusName = (value) => value.charAt(0).toUpperCase() + value.slice(1);
const eventNames = { created: 'Request added', approve: 'Approved', reject: 'Rejected', disburse: 'Payment recorded', pause: 'Recovery paused', resume: 'Recovery resumed', manager_recommend: 'Manager recommended', manager_decline: 'Manager declined' };
const advanceStatuses = ['all', 'pending', 'approved', 'active', 'paused', 'rejected', 'completed'];

function AdvanceStatusFilter({ value, onChange }) {
  const id = useId();
  const trigger = useRef(null);
  const menu = useRef(null);
  const options = useRef([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const close = (restoreFocus = false) => {
    menu.current?.hidePopover();
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  const show = (index = advanceStatuses.indexOf(value)) => {
    const bounds = trigger.current.getBoundingClientRect();
    const popup = menu.current;
    const availableBelow = window.innerHeight - bounds.bottom - 16;
    const above = availableBelow < 290 && bounds.top > availableBelow;
    Object.assign(popup.style, {
      left: `${Math.max(12, Math.min(bounds.left, window.innerWidth - Math.max(bounds.width, 180) - 12))}px`,
      top: above ? 'auto' : `${bounds.bottom + 8}px`,
      bottom: above ? `${window.innerHeight - bounds.top + 8}px` : 'auto',
      width: `${Math.max(bounds.width, 180)}px`,
      maxHeight: `${Math.max(80, above ? bounds.top - 20 : availableBelow)}px`,
    });
    popup.showPopover();
    setActive(index);
    setOpen(true);
    options.current[index]?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (!trigger.current.contains(event.target) && !menu.current.contains(event.target)) {
        menu.current.hidePopover(); setOpen(false);
      }
    };
    const reposition = (event) => {
      if (event.type === 'scroll' && menu.current.contains(event.target)) return;
      menu.current.hidePopover(); setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  return <div className="advance-status-filter">
    <span id={`${id}-label`} className="advance-status-label">Status</span>
    <button ref={trigger} type="button" className="advance-status-trigger" aria-haspopup="listbox"
      aria-expanded={open} aria-controls={`${id}-menu`} aria-labelledby={`${id}-label ${id}-value`}
      onPointerDown={(event) => { if (open) event.preventDefault(); }}
      onClick={() => open ? close(true) : show()} onKeyDown={(event) => {
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault(); show();
        }
      }}><span id={`${id}-value`}>{value === 'all' ? 'All statuses' : statusName(value)}</span><FiChevronDown aria-hidden="true" /></button>
    <div ref={menu} id={`${id}-menu`} popover="manual" role="listbox" aria-labelledby={`${id}-label`}
      className="advance-status-menu" onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
        let next = active;
        if (event.key === 'ArrowDown') next = (active + 1) % advanceStatuses.length;
        else if (event.key === 'ArrowUp') next = (active - 1 + advanceStatuses.length) % advanceStatuses.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = advanceStatuses.length - 1;
        else if (event.key.length === 1 && /[a-z]/i.test(event.key)) {
          const match = advanceStatuses.findIndex((status, index) => index > active && status.startsWith(event.key.toLowerCase()));
          next = match >= 0 ? match : advanceStatuses.findIndex((status) => status.startsWith(event.key.toLowerCase()));
          if (next < 0) return;
        } else return;
        event.preventDefault(); setActive(next); options.current[next]?.focus();
      }}>
      {advanceStatuses.map((status, index) => <button key={status} ref={(node) => { options.current[index] = node; }}
        type="button" role="option" aria-selected={value === status} tabIndex={active === index ? 0 : -1}
        className={`advance-status-option ${value === status ? 'is-selected' : ''}`}
        onFocus={() => setActive(index)} onClick={() => { onChange(status); close(true); }}>
        <span>{status === 'all' ? 'All statuses' : statusName(status)}</span>{value === status && <FiCheck aria-hidden="true" />}
      </button>)}
    </div>
  </div>;
}

function AdvanceWindow({ modal = true, id, labelledBy, onClose, children }) {
  const windowRef = useRef(null);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement;
    const window = windowRef.current;
    window.showModal();
    return () => {
      window.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [modal]);
  if (!modal) return <section id={id} className="loan-panel advance-register" aria-labelledby={labelledBy}>{children}</section>;
  return <dialog ref={windowRef} id={id} className="loan-dialog advance-window loans-page advances-page"
    aria-labelledby={labelledBy} onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => {
      if (event.target !== windowRef.current) return;
      const bounds = windowRef.current.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>{children}</dialog>;
}

function AdvanceDialog({ mode, selected, employees, admin, employeeId, onClose, onSaved }) {
  const dialog = useRef(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ employee_id: employeeId || '', amount: '', first_recovery: currentMonth(), reason: '', note: '' });
  const title = mode === 'add' ? (admin ? 'Add advance' : 'Request advance') : `${mode === 'reject' ? 'Reject' : 'Approve'} ADV-${selected.id}`;
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => previous?.focus();
  }, []);
  const field = (key) => ({ value: form[key], onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })), disabled: busy });
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      let id = selected?.id;
      if (mode === 'add') {
        const { data } = await api.post('/advances', { employee_id: form.employee_id, amount: form.amount,
          first_recovery: `${form.first_recovery}-01`, reason: form.reason });
        id = data.id;
      } else {
        await api.patch(`/advances/${id}/status`, { action: mode, note: form.note });
      }
      onSaved(id, mode === 'add'
        ? (admin ? 'Advance added successfully.' : 'Advance request added. It is awaiting admin approval.')
        : `Advance ${mode === 'approve' ? 'approved' : 'rejected'}.`);
    } catch (err) { setError(err.response?.data?.message || 'Unable to save this advance. Please try again.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="loan-dialog advance-dialog" aria-labelledby="advance-dialog-title"
    onCancel={(event) => { if (busy) event.preventDefault(); }} onClose={onClose}>
    <div className="loan-panel-head"><h2 id="advance-dialog-title">{title}</h2><button type="button" className="loan-button secondary" aria-label="Close" disabled={busy} onClick={onClose}><FiX /></button></div>
    <form onSubmit={submit}>
      <div className="loan-dialog-body">
        {error && <p className="loan-error" role="alert">{error}</p>}
        {mode === 'add' ? <>
          {admin && <label>Employee<select required {...field('employee_id')}><option value="">Select an employee</option>
            {employees.filter((employee) => employee.is_active !== false).map((employee) => <option key={employee.employee_id} value={employee.employee_id}>{employee.emp_code || employee.employee_id} — {employee.name}</option>)}
          </select></label>}
          <label>Advance amount (₹)<input type="number" required min="0.01" max="9999999999.99" step="0.01" {...field('amount')} /></label>
          <label>Payroll recovery month<input type="month" required {...field('first_recovery')} /></label>
          <label>Reason (optional)<textarea rows={3} maxLength={2000} {...field('reason')} /></label>
          <p className="loan-note">{admin
            ? 'This advance is saved as approved immediately. It carries no interest, and the full amount is deducted from salary in the selected month or the next generated payroll.'
            : 'An advance carries no interest. After approval, the full amount is deducted from salary in the selected month or the next generated payroll.'}</p>
        </> : <>
          <p>{selected.emp_code} — {selected.name}<br /><strong>{money(selected.amount)}</strong> · Recovery: {monthName(selected.first_recovery)}</p>
          <label>{mode === 'reject' ? 'Rejection reason (required)' : 'Approval note (optional)'}<textarea rows={3} required={mode === 'reject'} maxLength={2000} {...field('note')} /></label>
          {mode === 'approve' && <p className="loan-note">Approval enables the salary deduction from {monthName(selected.first_recovery)}.</p>}
        </>}
      </div>
      <div className="loan-dialog-actions"><button type="button" className="loan-button secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className={`loan-button ${mode === 'reject' ? 'advance-reject' : ''}`} disabled={busy || (mode === 'reject' && !form.note.trim())}>{busy ? 'Saving...' : mode === 'add' ? (admin ? 'Save advance' : 'Send request') : mode === 'approve' ? 'Approve advance' : 'Reject advance'}</button></div>
    </form>
  </dialog>;
}

export default function AdvancesPage({ admin = false }) {
  const [params] = useSearchParams();
  const [requests, setRequests] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [employeeId, setEmployeeId] = useState('');
  const [selectedId, setSelectedId] = useState(params.get('advance'));
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([api.get(admin ? '/advances' : '/advances/my'), ...(admin ? [api.get('/advances/employees')] : [])])
      .then(([list, register]) => {
        if (cancelled) return;
        setRequests(list.data); setEmployees(register?.data || []);
      }).catch((err) => { if (!cancelled) setError(err.response?.data?.message || 'Unable to load advances. Please refresh.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [admin, revision]);
  useEffect(() => { setSelectedId(params.get('advance')); }, [params]);
  useEffect(() => {
    setDetail(null); setDetailError('');
    if (!selectedId) return;
    let cancelled = false;
    setDetailLoading(true);
    api.get(`/advances/${selectedId}`).then(({ data }) => { if (!cancelled) setDetail(data); })
      .catch((err) => { if (!cancelled) setDetailError(err.response?.data?.message || 'Unable to load advance details.'); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, revision]);

  const search = query.trim().toLowerCase();
  const matches = (row) => `${row.emp_code} ${row.employee_id} ${row.name}`.toLowerCase().includes(search);
  const visibleEmployees = employees.filter(matches);
  const shown = requests.filter((row) => (admin || matches(row)) && (status === 'all' || row.status === status)
    && (!employeeId || String(row.employee_id) === employeeId));
  const total = useMemo(() => requests.filter((row) => ['approved', 'active', 'paused'].includes(row.status))
    .reduce((sum, row) => sum + Number(row.outstanding), 0), [requests]);
  const pending = requests.filter((row) => row.status === 'pending').length;
  const historyEmployee = employees.find((employee) => String(employee.employee_id) === employeeId);
  const openHistory = (id) => {
    setEmployeeId(String(id)); setStatus('all'); setSelectedId(null);
  };
  const openAdd = (id = '') => setDialog({ mode: 'add', employeeId: String(id) });
  const saved = (id, message) => {
    setDialog(null); setSuccess(message); setSelectedId(id); setRevision((current) => current + 1);
  };

  return <div className="loans-page advances-page">
    <div className="loan-page-head"><div><h1>{admin ? 'Advances' : 'My advances'}</h1><p>{admin ? 'Manage salary advances and review employee requests.' : 'Request a salary advance and track approval and repayment.'}</p></div>
      <div className="loan-head-actions"><button type="button" className="loan-button secondary" disabled={loading || !!dialog} onClick={() => setRevision((current) => current + 1)}><FiRefreshCw />Refresh</button>
        <button type="button" className="loan-button" disabled={!!dialog || (admin && (loading || !!error))} onClick={() => openAdd()}><FiPlus />{admin ? 'Add advance' : 'Request advance'}</button></div>
    </div>
    {error && <p className="loan-error" role="alert">{error}</p>}
    {success && <p className="loan-success" role="status">{success}</p>}
    <div className="loan-summary">
      <div className="loan-stat"><div><strong>Approved advance balance</strong></div><b>{loading || error ? '—' : money(total)}</b><span>Remaining salary advances</span></div>
      <div className="loan-stat peach"><div><strong>Pending requests</strong></div><b>{loading || error ? '—' : pending}</b><span>Awaiting admin approval</span></div>
      <div className="loan-stat"><div><strong>Recovered through payroll</strong></div><b>{loading || error ? '—' : money(requests.reduce((sum, row) => sum + Number(row.recovered), 0))}</b><span>Recorded salary deductions</span></div>
    </div>
    {admin && <section className="loan-panel advance-register" aria-labelledby="advance-employees-title">
      <div className="loan-panel-head"><h2 id="advance-employees-title">All employees</h2><label className="advance-search">Search employees<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Employee ID or name" /></label></div>
      <div className="advance-table-wrap"><table className="advance-table"><thead><tr><th>Employee ID</th><th>Name</th><th>Advance</th><th>Pending</th><th>Previous advances</th><th>Action</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={6} className="loan-empty">Loading employees...</td></tr> : error ? <tr><td colSpan={6} className="loan-empty">Employees unavailable. Refresh to retry.</td></tr> : !visibleEmployees.length ? <tr><td colSpan={6} className="loan-empty">No matching employees.</td></tr> : visibleEmployees.map((employee) => <tr key={employee.employee_id}>
          <td>{employee.emp_code || employee.employee_id}</td><td>{employee.name}{employee.is_active === false && <small>Inactive</small>}</td><td>{money(employee.advance)}</td><td>{money(employee.pending_advance)}</td><td><button type="button" className="loan-button secondary" aria-label={`View previous advances for ${employee.name}`} aria-expanded={employeeId === String(employee.employee_id)} aria-controls="advance-history" onClick={() => openHistory(employee.employee_id)}>Previous advances</button></td>
          <td><div className="advance-actions"><button type="button" className="loan-button secondary" disabled={employee.is_active === false || !!dialog} onClick={() => openAdd(employee.employee_id)}>Add advance</button></div></td>
        </tr>)}
      </tbody></table></div><p className="advance-help">Advance shows the approved balance remaining to recover. Pending requests are shown separately. Click Previous advances to view an employee's advance history.</p>
    </section>}

    {(!admin || employeeId) && <AdvanceWindow modal={admin} id="advance-history" labelledBy="advance-requests-title" onClose={() => setEmployeeId('')}>
      <div className="loan-panel-head"><div className="advance-window-heading"><span className="advance-eyebrow">Salary advances</span><h2 id="advance-requests-title">{admin ? 'Previous advances' : 'My requests'}</h2>{admin && historyEmployee && <p>{historyEmployee.name} · {historyEmployee.emp_code || historyEmployee.employee_id}</p>}</div><div className="advance-filters">
        <AdvanceStatusFilter value={status} onChange={setStatus} />
        {admin && <button type="button" className="loan-button secondary advance-window-close" aria-label="Close previous advances" onClick={() => { setEmployeeId(''); setSelectedId(null); }}><FiX /></button>}
      </div></div>
      {admin && Number(historyEmployee?.legacy_advance) > 0 && <p className="advance-help">Previously recorded advance balance: {money(historyEmployee.legacy_advance)}</p>}
      {admin && <div className="advance-history-caption"><strong>{shown.length} {shown.length === 1 ? 'advance' : 'advances'}</strong><span>{shown.length ? 'Select Details to view repayments and activity.' : status === 'all' ? 'Recorded advances will appear here.' : 'Choose another status to view more advances.'}</span></div>}
      <div className="advance-table-wrap"><table className="advance-table"><thead><tr><th>{admin ? 'Advance ID' : 'Request'}</th><th>Amount</th><th>Recovery month</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={5} className="loan-empty">Loading advances...</td></tr> : error ? <tr><td colSpan={5} className="loan-empty">Advances unavailable. Refresh to retry.</td></tr> : !shown.length ? <tr><td colSpan={5} className="loan-empty">{status === 'all' ? 'No previous advances recorded.' : 'No advances match this status.'}</td></tr> : shown.map((row) => <tr key={row.id} className={String(selectedId) === String(row.id) ? 'is-selected' : ''}>
          <td><strong>ADV-{row.id}</strong></td><td className="advance-amount">{money(row.amount)}</td><td>{monthName(row.first_recovery)}</td><td><span className={`loan-badge ${row.status}`}>{statusName(row.status)}</span></td>
          <td><div className="advance-actions"><button type="button" className="loan-button secondary" onClick={() => setSelectedId(row.id)}>Details</button>{admin && row.status === 'pending' && <>
            <button type="button" className="loan-button" disabled={!!dialog} onClick={() => setDialog({ mode: 'approve', selected: row })}>Approve</button>
            <button type="button" className="loan-button advance-reject" disabled={!!dialog} onClick={() => setDialog({ mode: 'reject', selected: row })}>Reject</button>
          </>}</div></td>
        </tr>)}
      </tbody></table></div>
    </AdvanceWindow>}

    {selectedId && <AdvanceWindow labelledBy="advance-detail-title" onClose={() => setSelectedId(null)}><div className="loan-panel-head"><div className="advance-window-heading"><span className="advance-eyebrow">Salary advance · ADV-{selectedId}</span><h2 id="advance-detail-title">Advance details</h2></div><button type="button" className="loan-button secondary advance-window-close" aria-label="Close details" onClick={() => setSelectedId(null)}><FiX /></button></div>
      <div className="loan-detail-body">{detailLoading ? <p role="status">Loading details...</p> : detailError ? <p className="loan-error" role="alert">{detailError}</p> : detail && <>
        <div className="loan-detail-identity"><h3>ADV-{detail.id} · {detail.name}</h3><span className={`loan-badge ${detail.status}`}>{statusName(detail.status)}</span></div>
        <dl className="loan-facts"><div><dt>Employee ID</dt><dd>{detail.emp_code}</dd></div><div><dt>Advance amount</dt><dd>{money(detail.amount)}</dd></div><div><dt>Recovery month</dt><dd>{monthName(detail.first_recovery)}</dd></div><div><dt>Recovered</dt><dd>{money(detail.recovered)}</dd></div><div><dt>Remaining balance</dt><dd>{money(detail.outstanding)}</dd></div><div className="advance-reason"><dt>Reason</dt><dd>{detail.reason || "No reason provided"}</dd></div></dl>
        <div className="advance-activity-grid"><details className="loan-history" open><summary>Activity & decisions</summary>{detail.events.map((entry, index) => <div key={index} className={entry.action === 'reject' ? 'loan-rejection-event' : ''}><strong>{eventNames[entry.action] || entry.action}</strong><small>{entry.actor || 'Former user'} · {new Date(entry.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</small>{entry.note && <p>{entry.action === 'reject' && <strong>Rejection reason: </strong>}{entry.note}</p>}</div>)}</details>
        <div className="loan-schedule"><h3>Payroll recovery history</h3>{detail.recoveries.length ? detail.recoveries.map((entry) => <div key={entry.payslip_id}><span>{monthName(`${entry.year}-${String(entry.month).padStart(2, '0')}-01`)}</span><strong>{money(entry.amount)}</strong></div>) : <p className="advance-recovery-empty">No salary deductions recorded yet.</p>}</div></div>
      </>}</div>
    </AdvanceWindow>}
    {dialog && <AdvanceDialog key={`${dialog.mode}-${dialog.selected?.id || dialog.employeeId}`} {...dialog} employees={employees} admin={admin} onClose={() => setDialog(null)} onSaved={saved} />}
  </div>;
}
