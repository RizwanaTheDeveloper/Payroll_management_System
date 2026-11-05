import { Fragment, useEffect, useState } from 'react';
import { FiInbox, FiRefreshCw } from 'react-icons/fi';
import api from '../../api';
import { EmptyState, Skeleton } from '../../components/ui';
import { formatINR, titleCase } from '../../utils/format';
import './Team.css';

const money = (value) => formatINR(value, Number(value) % 1 ? 2 : 0);
const STATUS_TONE = { pending: 'warn', approved: 'ok', active: 'ok', rejected: 'bad', paused: 'warn' };
const monthLabel = (value) => new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

function decisionBadge(request) {
  if (request.manager_decision === 'recommended') return <span className="team-badge ok">You recommended</span>;
  if (request.manager_decision === 'declined') return <span className="team-badge bad">You declined</span>;
  if (request.status === 'pending') return <span className="team-badge warn">Needs your review</span>;
  return null;
}

export default function TeamRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [declining, setDeclining] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [loans, advances] = await Promise.all([api.get('/loans/team'), api.get('/advances/team')]);
      const merged = [
        ...loans.data.map((row) => ({ ...row, kind: 'loan' })),
        ...advances.data.map((row) => ({ ...row, kind: 'advance' })),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setRequests(merged);
    } catch (err) {
      setMessage({ error: err.response?.data?.message || 'Unable to load team requests.' });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  async function decide(request, decision, reason = '') {
    setBusy(true);
    setMessage(null);
    try {
      await api.patch(`/${request.kind === 'loan' ? 'loans' : 'advances'}/${request.id}/recommendation`, { decision, note: reason });
      setDeclining(null);
      setNote('');
      setMessage({ ok: 'Your recommendation was recorded. An administrator gives the final approval.' });
      await load();
    } catch (err) {
      setMessage({ error: err.response?.data?.message || 'Unable to save your recommendation.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="team-page">
      <div className="team-head">
        <div>
          <h1>Team loans &amp; advances</h1>
          <p className="team-sub">Recommend or decline your team's requests. Administrators give the final approval and payment.</p>
        </div>
        <button className="team-btn" type="button" onClick={load}><FiRefreshCw aria-hidden="true" /> Refresh</button>
      </div>
      {message?.error && <p className="team-msg error" role="alert">{message.error}</p>}
      {message?.ok && <p className="team-msg ok" role="status">{message.ok}</p>}

      <section className="team-card">
        <h2>Requests</h2>
        {loading ? <Skeleton rows={4} /> : requests.length === 0 ? <EmptyState icon={FiInbox} title="Nothing to review">Loan and salary advance requests from your team will appear here for your recommendation.</EmptyState> : (
          <div className="team-scroll"><table>
            <thead><tr><th>Employee</th><th>Type</th><th>Amount</th><th>Recovery</th><th>Reason</th><th>Status</th><th>Your decision</th></tr></thead>
            <tbody>{requests.map((request) => {
              const key = `${request.kind}-${request.id}`;
              const open = request.status === 'pending' && !request.manager_decision;
              return (
                <Fragment key={key}>
                <tr>
                  <td>{request.name}<div className="team-sub">{request.emp_code}</div></td>
                  <td><span className="team-badge">{request.kind === 'loan' ? 'Loan' : 'Advance'}</span></td>
                  <td>{money(request.amount)}{request.kind === 'loan' && request.instalment_count ? <div className="team-sub">{request.instalment_count} instalments</div> : null}</td>
                  <td>{monthLabel(request.first_recovery)}</td>
                  <td style={{ maxWidth: 240 }}>{request.reason || '-'}</td>
                  <td><span className={`team-badge ${STATUS_TONE[request.status] || ''}`}>{titleCase(request.status)}</span></td>
                  <td>
                    <div className="team-decision">
                      {decisionBadge(request)}
                      {request.manager_note && <div className="team-sub">{request.manager_note}</div>}
                      {open && declining !== key && (
                        <div className="team-actions">
                          <button className="team-btn primary" type="button" disabled={busy} onClick={() => decide(request, 'recommended')}>Recommend</button>
                          <button className="team-btn danger" type="button" disabled={busy} onClick={() => { setDeclining(key); setNote(''); }}>Decline</button>
                        </div>
                      )}
                      {open && declining === key && <span className="team-sub">Add a reason below</span>}
                    </div>
                  </td>
                </tr>
                {open && declining === key && (
                  <tr className="team-reason-row"><td colSpan={7}>
                    <div className="team-reason">
                      <label className="team-field">Reason for declining {request.name}&apos;s {request.kind === 'loan' ? 'loan' : 'advance'} (required)
                        <textarea rows={2} autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="This note is shared with the administrator" />
                      </label>
                      <div className="team-actions end">
                        <button className="team-btn" type="button" onClick={() => setDeclining(null)}>Cancel</button>
                        <button className="team-btn danger" type="button" disabled={busy || !note.trim()} onClick={() => decide(request, 'declined', note)}>Confirm decline</button>
                      </div>
                    </div>
                  </td></tr>
                )}
                </Fragment>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
