import { useEffect, useRef, useState } from 'react';
import { FiX, FiClipboard } from 'react-icons/fi';
import api from '../api';
import { loanDeductionItems } from '../utils/payrollDeductions';

const money = (value) => Number(value || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const lossOfPayLabel = (days) => days == null
  ? 'Loss Of Pay'
  : `Loss Of Pay (${days} ${Number(days) === 1 ? 'day' : 'days'})`;

export default function PayrollWorkflow({ payslip, onChanged }) {
  const dialog = useRef(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [events, setEvents] = useState([]);
  const [eventsError, setEventsError] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setEventsError('');
    api.get(`/payslips/${payslip.id}/events`, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setEvents(data); })
      .catch(() => { if (!controller.signal.aborted) setEventsError('Unable to load change history.'); });
    return () => controller.abort();
  }, [open, payslip.id, payslip.updated_at]);
  const gross = ['basic','hra','special_allowance','lta','other_allowances','allowances'].reduce((n,k) => n + Number(payslip[k] || 0), 0);
  const largeDeduction = gross > 0 && (gross - Number(payslip.net_pay)) > gross / 2;
  function show() { setError(''); setReason(''); setReference(''); setAcknowledged(false); setOpen(true); dialog.current.showModal(); }
  async function save(endpoint, body) {
    setBusy(true); setError('');
    try { await api.patch(`/payslips/${payslip.id}/${endpoint}`, body); await onChanged(); }
    catch (err) { setError(err.response?.data?.message || 'Unable to save this change.'); }
    finally { setBusy(false); }
  }
  const titleId = `payroll-workflow-${payslip.id}`;
  return <>
    <button type="button" className="download-btn" onClick={show}><FiClipboard aria-hidden="true" />Manage payroll</button>
    <dialog ref={dialog} className="payroll-workflow-dialog" aria-labelledby={titleId} onClose={() => setOpen(false)} onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <div className="payroll-workflow-heading"><div><h2 id={titleId}>{payslip.name} · Payroll</h2><p>{String(payslip.month).padStart(2, '0')}/{payslip.year}</p></div><button type="button" aria-label="Close payroll details" disabled={busy} onClick={() => dialog.current.close()}><FiX /></button></div>
      <div className="payroll-workflow-body">
        {error && <p className="payroll-workflow-error" role="alert">{error}</p>}
        <p><span className={`payroll-state payroll-state-${payslip.status}`}>{payslip.status}</span> <span className={`payroll-state payroll-state-${payslip.payment_status}`}>{payslip.payment_status}</span></p>
        <dl className="payroll-deduction-breakdown">{[
          ['Gross earnings', gross], ['EPF', payslip.epf], ['Professional tax', payslip.professional_tax],
          ...loanDeductionItems(payslip).map((item) => [item.label, item.amount]),
          ...(payslip.unpaid_leave_deduction == null ? [['Other / Loss Of Pay deductions', payslip.deductions]] : [[lossOfPayLabel(payslip.unpaid_leave_days ?? payslip.calculation_snapshot?.unpaid_dates?.length), payslip.unpaid_leave_deduction], ['Additional deductions', payslip.additional_deductions]]),
          ['Total deductions', gross - Number(payslip.net_pay)], ['Take-home pay', payslip.net_pay],
        ].map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{money(amount)}</dd></div>)}</dl>
        {payslip.employed_days != null && <p className="payroll-policy-note">{payslip.employed_days} employment days · {payslip.net_paid_days} paid days · {payslip.month_days} calendar days. Earnings are prorated by employment dates and effective salary versions.</p>}
        {payslip.status === 'draft' && <button className="reports-primary" type="button" disabled={busy} onClick={() => save('status', { status: 'reviewed' })}>Mark as reviewed</button>}
        {payslip.status === 'submitted' && <p className="payroll-policy-note">Submitted by the manager for your approval{payslip.submitted_at ? ` on ${new Date(payslip.submitted_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ''}. Approving locks payroll so the manager can publish it. To send it back, use Reopen for correction below with a reason.</p>}
        {['reviewed', 'submitted'].includes(payslip.status) && <>
          {largeDeduction && <label className="payroll-warning-confirm"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />I reviewed deductions exceeding 50% of gross earnings.</label>}
          <button className="reports-primary" type="button" disabled={busy || (largeDeduction && !acknowledged)} onClick={() => save('status', { status: 'finalized', acknowledge_warnings: acknowledged })}>{payslip.status === 'submitted' ? 'Approve and lock payroll' : 'Finalize and lock payroll'}</button>
        </>}
        {payslip.status !== 'draft' && <section className="payroll-workflow-section"><h3>{payslip.payment_status === 'paid' ? 'Reverse recorded payment' : 'Reopen for correction'}</h3><p className="payroll-policy-note">{payslip.payment_status === 'paid' ? 'Record why the payment entry is being reversed. This updates the record only; it does not move funds.' : 'Reopening returns this payslip to draft. The reason and previous values remain in its change history.'}</p><label>Reason<textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label><button className="reports-secondary" type="button" disabled={busy || !reason.trim()} onClick={() => payslip.payment_status === 'paid' ? save('payment', { payment_status: 'unpaid', reason }) : save('status', { status: 'draft', reason })}>{payslip.payment_status === 'paid' ? 'Reverse payment record' : 'Reopen as draft'}</button></section>}
        {payslip.status === 'finalized' && payslip.payment_status === 'unpaid' && <section className="payroll-workflow-section"><h3>Record salary payment</h3><p className="payroll-policy-note">Record a payment already made through your bank or payment provider.</p><label>Payment date<input type="date" min="2000-01-01" max={today()} value={paidOn} onChange={(event) => setPaidOn(event.target.value)} /></label><label>Bank / transaction reference<input type="text" maxLength={150} value={reference} onChange={(event) => setReference(event.target.value)} /></label><button className="reports-primary" type="button" disabled={busy || !reference.trim() || !paidOn} onClick={() => save('payment', { payment_status: 'paid', paid_on: paidOn, payment_reference: reference })}>Mark as paid</button></section>}
        {payslip.status === 'finalized' && (payslip.published_at
          ? <p className="payroll-policy-note">Published to the employee on {new Date(payslip.published_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}.</p>
          : <section className="payroll-workflow-section"><h3>Publish payslip</h3><p className="payroll-policy-note">The employee cannot see this payslip until it is published. Managers publish their team's approved payslips; you can also publish it here.</p><button className="reports-primary" type="button" disabled={busy} onClick={() => save('publish', {})}>Publish to employee</button></section>)}
        {payslip.payment_status === 'paid' && <p>Paid on {String(payslip.paid_on).slice(0, 10)} · Reference: {payslip.payment_reference}</p>}
        <section className="payroll-workflow-section"><h3>Change history</h3>{eventsError ? <p role="alert">{eventsError}</p> : events.length ? <ol className="payroll-history">{events.map((event) => <li key={event.id}><strong>{event.action.replaceAll('_', ' ')}</strong><span>{event.actor} · {new Date(event.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>{event.reason && <p>{event.reason}</p>}</li>)}</ol> : <p className="payroll-policy-note">No recorded changes yet.</p>}</section>
      </div>
    </dialog>
  </>;
}
