import { useEffect, useRef, useState } from 'react';
import { FiClock, FiInfo, FiRefreshCw, FiRepeat } from 'react-icons/fi';
import { FaRupeeSign } from 'react-icons/fa';
import api from '../../api';
import { loanAmounts } from '../../utils/loanAmounts';
import LoanRepaymentTotal from '../../components/LoanRepaymentTotal';

const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const monthName = (value) => new Date(`${value.slice(0, 7)}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const statusName = (value) => value[0].toUpperCase() + value.slice(1);
const emptyForm = () => ({ amount: '', interest_percentage: '0', instalment_count: '10', first_recovery: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7), reason: '' });
const eventNames = { created: 'Request submitted', approve: 'Approved', reject: 'Rejected', disburse: 'Payment recorded', pause: 'Recovery paused', resume: 'Recovery resumed' };

export default function Loans() {
  const [list, setList] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [form, setForm] = useState(emptyForm);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    api.get('/loans/my').then(({ data }) => {
      if (!cancelled) { setList(data); setSelectedId((current) => current || data[0]?.id || null); }
    }).catch((err) => { if (!cancelled) setError(err.response?.data?.message || 'Unable to load your loans. Please refresh to retry.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision]);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetail(null); setDetailLoading(true); setDetailError('');
    api.get(`/loans/${selectedId}`).then(({ data }) => { if (!cancelled) setDetail(data); })
      .catch((err) => { if (!cancelled) setDetailError(err.response?.data?.message || 'Unable to load request details. Please refresh to retry.'); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, revision]);
  const field = (key) => ({ value: form[key], onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })) });
  const { interest: interestAmount, total: totalRepayable, monthlyPrincipal, monthlyInterest, instalment: monthlyInstalment } = loanAmounts(form.amount, form.interest_percentage, form.instalment_count);
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setFormError(''); setSuccess('');
    try {
      const { data } = await api.post('/loans', { ...form, first_recovery: `${form.first_recovery}-01` });
      setSuccess('Loan request submitted. Your administrator will review it.');
      setForm(emptyForm()); setSelectedId(data.id); setRevision((current) => current + 1);
    } catch (err) { setFormError(err.response?.data?.message || 'Unable to submit your request. Please try again.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  const active = list.filter((loan) => ['approved', 'active', 'paused'].includes(loan.status));
  return <div className="loans-page">
    <div className="loan-page-head"><div><h1>My loans</h1><p>Request a salary loan and track approval, payment and recovery.</p></div><button type="button" className="loan-button secondary" disabled={loading || busy} onClick={() => setRevision((current) => current + 1)}><FiRefreshCw />Refresh</button></div>
    {error && <p className="loan-error" role="alert">{error}</p>}
    {success && <p className="loan-success" role="status">{success}</p>}
    <div className="loan-summary">
      <div className="loan-stat"><div><strong>Outstanding balance</strong><FaRupeeSign /></div><b>{loading || error ? '—' : money(active.reduce((total, loan) => total + Number(loan.outstanding), 0))}</b><span>Across your approved loans</span></div>
      <div className="loan-stat"><div><strong>Recovered in payroll</strong><FiRepeat /></div><b>{loading || error ? '—' : money(list.reduce((total, loan) => total + Number(loan.recovered), 0))}</b><span>Total recorded deductions</span></div>
      <div className="loan-stat peach"><div><strong>Pending requests</strong><FiClock /></div><b>{loading || error ? '—' : list.filter((loan) => loan.status === 'pending').length}</b><span>Awaiting administrator review</span></div>
    </div>
    <div className="loan-workspace">
      <section className="loan-panel" aria-labelledby="my-loan-requests"><div className="loan-panel-head"><h2 id="my-loan-requests">My requests</h2></div>
        <div className="loan-table-wrap"><table className="loan-table"><thead><tr><th>Request</th><th>Amount</th><th>Monthly recovery</th><th>Status</th></tr></thead><tbody>
          {loading ? <tr><td colSpan={4} className="loan-empty" role="status">Loading requests…</td></tr> : error ? <tr><td colSpan={4} className="loan-empty">Requests unavailable. Refresh to retry.</td></tr> : !list.length ? <tr><td colSpan={4} className="loan-empty">No loan requests yet. Use the request form to get started.</td></tr> : list.map((loan) => <tr key={loan.id} className={loan.id === selectedId ? 'is-selected' : ''}><td><button type="button" className="loan-employee" aria-pressed={loan.id === selectedId} onClick={() => setSelectedId(loan.id)}><span><strong>LOAN-{loan.id}</strong><small>{monthName(loan.first_recovery)}</small></span></button></td><td>{money(loan.amount)}<small>{loan.interest_percentage}% {loan.instalment_count ? 'monthly' : 'one-time'} interest; {money(loan.total_repayable)} total</small></td><td>{money(loan.instalment)}</td><td><span className={`loan-badge ${loan.status}`}>{statusName(loan.status)}</span></td></tr>)}
        </tbody></table></div>
        <div className="loan-panel-head"><h2>Request detail</h2></div>
        <div className="loan-detail-body loan-detail">{detailLoading ? <p role="status">Loading request detail…</p> : detailError ? <p className="loan-error" role="alert">{detailError}</p> : !detail ? <p className="loan-empty">Select a request to view its progress.</p> : <>
          <div className="loan-detail-identity"><h3>LOAN-{detail.id}</h3><span className={`loan-badge ${detail.status}`}>{statusName(detail.status)}</span></div>
          <dl className="loan-facts"><div><dt>Requested amount</dt><dd>{money(detail.amount)}</dd></div>{detail.instalment_count && <div><dt>Interest per month ({detail.interest_percentage}%)</dt><dd>{money(detail.monthly_interest_amount)}<small>On the original loan amount</small></dd></div>}<div><dt>Total interest ({detail.interest_percentage}% {detail.instalment_count ? 'per month' : 'one-time'})</dt><dd>{money(detail.interest_amount)}</dd></div><div><dt>Total repayment (all instalments)</dt><dd><LoanRepaymentTotal total={detail.total_repayable} instalment={detail.instalment} count={detail.instalment_count} /></dd></div><div><dt>Monthly instalment</dt><dd>{money(detail.instalment)}{detail.instalment_count && <small>{detail.instalment_count} instalments</small>}</dd></div><div><dt>First recovery month</dt><dd>{monthName(detail.first_recovery)}</dd></div><div><dt>Paid to you</dt><dd>{detail.disbursed_on ? new Date(`${detail.disbursed_on}T12:00:00`).toLocaleDateString('en-IN') : 'Not yet paid'}</dd></div><div><dt>Recovered in payroll</dt><dd>{money(detail.recovered)}</dd></div><div><dt>{'Outstanding balance'}</dt><dd>{money(detail.outstanding)}</dd></div><div><dt>Reason</dt><dd>{detail.reason}</dd></div></dl>
          <div className="loan-callout"><FiInfo /><div><strong>{detail.status === 'pending' ? 'Awaiting review' : detail.status === 'approved' ? 'Approved, awaiting payment' : detail.status === 'paused' ? 'Recovery paused' : detail.status === 'rejected' ? 'Request rejected' : detail.status === 'completed' ? 'Fully recovered' : 'Recovery in progress'}</strong><p>{detail.status === 'pending' ? 'Your administrator will review your request.' : detail.status === 'rejected' ? 'See the decision reason in your activity history below.' : 'Payroll deductions start in the first recovery month after approval. The final instalment collects the remaining balance, including any rounding remainder.'}</p></div></div>
          <div className="loan-schedule"><h3>Payroll recovery history</h3>{detail.recoveries.length ? detail.recoveries.map((entry) => <div key={entry.payslip_id}><span>{monthName(`${entry.year}-${String(entry.month).padStart(2, '0')}-01`)}</span><strong>{money(entry.amount)}</strong></div>) : <p>No payroll recoveries recorded yet.</p>}</div>
          <details className="loan-history" open><summary>Request and decision history</summary>{detail.events.map((entry, index) => <div key={index} className={entry.action === 'reject' ? 'loan-rejection-event' : ''}><strong>{eventNames[entry.action] || entry.action}</strong><small>{entry.actor || 'Former user'} · {new Date(entry.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</small>{entry.note && <p>{entry.action === 'reject' && <strong>Rejection reason: </strong>}{entry.note}</p>}</div>)}</details>
        </>}</div>
      </section>
      <section className="loan-panel" aria-labelledby="request-loan-title"><div className="loan-panel-head"><h2 id="request-loan-title">Request a loan</h2></div>
        <form className="loan-dialog-body" onSubmit={submit}>
          {formError && <p className="loan-error" role="alert">{formError}</p>}
          <label>Loan amount (₹)<input type="number" required min="0.01" max="9999999999.99" step="0.01" disabled={busy} {...field('amount')} /></label>
          <label>Interest per month (%)<input type="number" required min="0" max="100" step="0.01" disabled={busy} aria-describedby="loan-monthly-interest-help" {...field('interest_percentage')} /><small id="loan-monthly-interest-help">Flat interest calculated on the original loan amount each month.</small></label>
          <label>Number of monthly instalments<input type="number" required min="1" max="360" step="1" disabled={busy} {...field('instalment_count')} /></label>
          <section className="loan-repayment-summary" aria-labelledby="loan-repayment-title">
            <h3 id="loan-repayment-title">Repayment summary</h3>
            <dl className="loan-repayment-breakdown">
              <div><dt>Principal per month</dt><dd>{money(monthlyPrincipal)}</dd></div>
              <div><dt>Interest per month<small>On the original loan amount</small></dt><dd>{money(monthlyInterest)}</dd></div>
              <div><dt>Total interest<small>For {form.instalment_count || 0} instalments</small></dt><dd>{money(interestAmount)}</dd></div>
              <div className="loan-repayment-monthly"><dt>Monthly salary deduction<small>Principal + interest</small></dt><dd>{money(monthlyInstalment)}</dd></div>
              <div className="loan-repayment-total"><dt>Total repayment</dt><dd><LoanRepaymentTotal total={totalRepayable} instalment={monthlyInstalment} count={form.instalment_count} /></dd></div>
            </dl>
            <p className="loan-repayment-footnote">The final instalment includes any rounding remainder.</p>
          </section>
          <label>First recovery month<input type="month" required disabled={busy} {...field('first_recovery')} /></label>
          <label>Reason<textarea rows={4} required maxLength={2000} disabled={busy} {...field('reason')} /></label>
          <p className="loan-note"><FiInfo />Your request goes to the administrator for approval. Payroll deductions begin in the first recovery month after approval.</p>
          <button className="loan-button" disabled={busy}>{busy ? 'Submitting…' : 'Send request'}</button>
        </form>
      </section>
    </div>
  </div>;
}
