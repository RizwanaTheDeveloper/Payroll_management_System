import { useCallback, useEffect, useState } from 'react';
import { FiClock } from 'react-icons/fi';
import api from '../api';
import { EmptyState } from './ui';
import { formatDate, titleCase } from '../utils/format';
import { refreshNotifications } from '../hooks/useNotifications';
import '../pages/manager/Team.css';

const WINDOW_DAYS = 60;
const istDate = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);
const TONES = { pending: 'warn', approved: 'ok', rejected: 'bad', cancelled: '' };

// Employee view: ask for a missed or wrong day to be recorded as present, and follow the decision.
export default function AttendanceRequests() {
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({ work_date: istDate(-1), day_type: 'full', check_in_time: '', check_out_time: '', reason: '' });
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/attendance-requests/my').then(({ data }) => setRequests(data)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/attendance-requests', form);
      setForm({ ...form, reason: '', check_in_time: '', check_out_time: '' });
      setMessage({ ok: 'Request sent for approval.' });
      load();
      refreshNotifications();
    } catch (err) {
      setMessage({ error: err.response?.data?.message || 'Unable to send your request.' });
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id) {
    try {
      await api.delete(`/attendance-requests/${id}`);
      load();
      refreshNotifications();
    } catch (err) {
      setMessage({ error: err.response?.data?.message || 'Unable to withdraw this request.' });
    }
  }

  return (
    <div className="team-page" style={{ marginTop: 24 }}>
      <section className="team-card">
        <h2>Request an attendance correction</h2>
        <form onSubmit={submit} className="team-form">
          <p className="team-sub" style={{ margin: 0 }}>Forgot to sign in, or a day is marked wrong? Ask for it to be recorded as present. Your manager approves it (an administrator if you have no manager).</p>
          <div className="team-controls">
            <label>Date <input type="date" required min={istDate(-WINDOW_DAYS)} max={istDate()} value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })} /></label>
            <label>Day <select value={form.day_type} onChange={(e) => setForm({ ...form, day_type: e.target.value })}><option value="full">Full day</option><option value="half">Half day</option></select></label>
            <label>Check-in time (optional) <input type="time" value={form.check_in_time} onChange={(e) => setForm({ ...form, check_in_time: e.target.value })} /></label>
            <label>Check-out time (optional) <input type="time" value={form.check_out_time} onChange={(e) => setForm({ ...form, check_out_time: e.target.value })} /></label>
          </div>
          <p className="team-sub" style={{ margin: 0 }}>Forgot to check out? Choose that day and enter the time you finished. Times are Indian time.</p>
          <label className="team-field">Reason
            <textarea required rows={3} maxLength={500} style={{ width: '100%' }} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="What happened?" />
          </label>
          {message?.error && <p className="team-msg error" role="alert">{message.error}</p>}
          {message?.ok && <p className="team-msg ok" role="status">{message.ok}</p>}
          <div className="team-actions end"><button className="team-btn primary" type="submit" disabled={busy || !form.reason.trim()}>Send request</button></div>
        </form>
      </section>

      <section className="team-card">
        <h2>My correction requests</h2>
        {requests.length === 0 ? <EmptyState icon={FiClock} title="No correction requests yet">If a day is missing or wrong, send a request above and your manager will review it.</EmptyState> : (
          <div className="team-scroll"><table>
            <thead><tr><th>Date</th><th>Day</th><th>Reason</th><th>Status</th><th /></tr></thead>
            <tbody>{requests.map((request) => (
              <tr key={request.id}>
                <td>{formatDate(request.work_date)}</td>
                <td>{titleCase(request.day_type)} day{(request.check_in_time || request.check_out_time) && <div className="team-sub">{request.check_in_time || '—'} to {request.check_out_time || '—'}</div>}</td>
                <td style={{ maxWidth: 260 }}>{request.reason}</td>
                <td>
                  <span className={`team-badge ${TONES[request.status]}`} style={{ textTransform: 'capitalize' }}>{request.status}</span>
                  {request.status === 'pending' && <div className="team-sub">With {request.manager_name || 'administrator'}</div>}
                  {request.decided_by_name && request.status !== 'cancelled' && <div className="team-sub">{request.decided_by_name}{request.decision_note ? `: ${request.decision_note}` : ''}</div>}
                </td>
                <td>{request.status === 'pending' && <button className="team-btn" type="button" onClick={() => withdraw(request.id)}>Withdraw</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
