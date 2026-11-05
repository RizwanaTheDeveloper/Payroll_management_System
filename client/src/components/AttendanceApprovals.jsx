import { Fragment, useCallback, useEffect, useState } from 'react';
import { FiCheckCircle } from 'react-icons/fi';
import api from '../api';
import { EmptyState, Skeleton } from './ui';
import { formatDate, titleCase } from '../utils/format';
import { refreshNotifications } from '../hooks/useNotifications';
import '../pages/manager/Team.css';

const TONES = { pending: 'warn', approved: 'ok', rejected: 'bad', cancelled: '' };

// Approver view (manager: their team; administrator: everyone). Approving records the day as present.
export default function AttendanceApprovals({ endpoint, admin = false }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(endpoint)
      .then(({ data }) => setRequests(data))
      .catch((err) => setMessage({ error: err.response?.data?.message || 'Unable to load requests.' }))
      .finally(() => setLoading(false));
  }, [endpoint]);
  useEffect(load, [load]);

  async function decide(request, decision, reason = '') {
    setBusy(true);
    setMessage(null);
    try {
      await api.patch(`/attendance-requests/${request.id}/decision`, { decision, note: reason });
      setRejecting(null);
      setNote('');
      setMessage({ ok: decision === 'approved' ? `${request.name}'s attendance was recorded as present.` : 'Request rejected.' });
      load();
      refreshNotifications();
    } catch (err) {
      setMessage({ error: err.response?.data?.message || 'Unable to save your decision.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="team-page">
      {message?.error && <p className="team-msg error" role="alert">{message.error}</p>}
      {message?.ok && <p className="team-msg ok" role="status">{message.ok}</p>}
      <section className="team-card">
        <h2>Attendance correction requests</h2>
        {loading ? <Skeleton rows={3} /> : requests.length === 0 ? <EmptyState icon={FiCheckCircle} title="All caught up">There are no attendance correction requests to review.</EmptyState> : (
          <div className="team-scroll"><table>
            <thead><tr><th>Employee</th><th>Date</th><th>Reason</th><th>Status</th><th>Decision</th></tr></thead>
            <tbody>{requests.map((request) => (
              <Fragment key={request.id}>
              <tr>
                <td>{request.name}<div className="team-sub">{request.emp_code}</div></td>
                <td>{formatDate(request.work_date)}<div className="team-sub">{titleCase(request.day_type)} day</div>{(request.check_in_time || request.check_out_time) && <div className="team-sub">{request.check_in_time || '—'} to {request.check_out_time || '—'}</div>}</td>
                <td style={{ maxWidth: 300 }}>{request.reason}</td>
                <td>
                  <span className={`team-badge ${TONES[request.status]}`} style={{ textTransform: 'capitalize' }}>{request.status}</span>
                  {request.status === 'pending' && admin && (
                    <div className="team-sub">
                      {request.manager_name ? `With ${request.manager_name}` : 'No manager'}
                      {request.waiting_days > 0 && ` · waiting ${request.waiting_days}d`}
                      {request.escalated && ' · escalated'}
                    </div>
                  )}
                  {request.status !== 'pending' && request.decided_by_name && <div className="team-sub">{request.decided_by_name}{request.decision_note ? `: ${request.decision_note}` : ''}</div>}
                </td>
                <td>
                  {request.status === 'pending' && rejecting !== request.id && (
                    <div className="team-actions">
                      <button className="team-btn primary" type="button" disabled={busy} onClick={() => decide(request, 'approved')}>Approve</button>
                      <button className="team-btn danger" type="button" disabled={busy} onClick={() => { setRejecting(request.id); setNote(''); }}>Reject</button>
                    </div>
                  )}
                  {rejecting === request.id && <span className="team-sub">Add a reason below</span>}
                </td>
              </tr>
              {rejecting === request.id && (
                <tr className="team-reason-row"><td colSpan={5}>
                  <div className="team-reason">
                    <label className="team-field">Reason for rejecting {request.name}&apos;s request (required)
                      <textarea rows={2} autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="Tell the employee why this cannot be approved" />
                    </label>
                    <div className="team-actions end">
                      <button className="team-btn" type="button" onClick={() => setRejecting(null)}>Cancel</button>
                      <button className="team-btn danger" type="button" disabled={busy || !note.trim()} onClick={() => decide(request, 'rejected', note)}>Confirm reject</button>
                    </div>
                  </div>
                </td></tr>
              )}
              </Fragment>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
