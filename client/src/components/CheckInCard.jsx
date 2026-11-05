import { useCallback, useEffect, useState } from 'react';
import { FiLogIn, FiLogOut, FiClock, FiCheckCircle, FiCalendar, FiAlertCircle } from 'react-icons/fi';
import api from '../api';
import './CheckInCard.css';

const clock = (value) => new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
const duration = (ms) => {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
};
const formatLate = (time) => {
  const [hour, minute] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
};

// Today's attendance for the signed-in employee or manager: check in when the day starts, check out when it ends.
export default function CheckInCard({ onChange }) {
  const [info, setInfo] = useState(null);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/attendance/today')
      .then(({ data }) => {
        setInfo(data);
        setOffset(new Date(data.now).getTime() - Date.now());
      })
      .catch((err) => setError(err.response?.data?.message || 'Unable to load today\'s attendance.'));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(path) {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/attendance/${path}`);
      setInfo((current) => ({ ...current, record: data.record }));
      if (onChange) onChange();
    } catch (err) {
      setError(err.response?.data?.message || 'That did not work. Please try again.');
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!info) {
    return <section className="checkin-card" aria-busy="true">{error ? <p className="checkin-error" role="alert">{error}</p> : <span className="checkin-muted">Loading today&apos;s attendance…</span>}</section>;
  }

  const { record } = info;
  const serverNow = now + offset;
  const dateLabel = new Date(`${info.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const blocked = record && ['leave', 'paid_leave', 'absent'].includes(record.status);
  const checkedIn = record && record.check_in;
  const checkedOut = checkedIn && record.check_out;

  let state = 'ready';
  if (blocked) state = 'blocked';
  else if (checkedOut) state = 'done';
  else if (checkedIn) state = 'working';

  return (
    <section className={`checkin-card is-${state}`} aria-label="Today's attendance">
      <div className="checkin-icon" aria-hidden="true">
        {state === 'done' ? <FiCheckCircle /> : state === 'blocked' ? <FiCalendar /> : <FiClock />}
      </div>

      <div className="checkin-body">
        <span className="checkin-date">{dateLabel}</span>
        {state === 'ready' && (<>
          <strong>You haven&apos;t checked in yet</strong>
          <span className="checkin-muted">Check in by {formatLate(info.late_after)} to be on time. Your check-in time is what payroll uses.</span>
        </>)}
        {state === 'working' && (<>
          <strong>Checked in at {clock(record.check_in)}
            {record.is_late ? <span className="checkin-chip late"><FiAlertCircle aria-hidden="true" /> Late</span> : <span className="checkin-chip ok">On time</span>}
          </strong>
          <span className="checkin-muted">Working for {duration(serverNow - new Date(record.check_in).getTime())}. Check out when you finish for the day.</span>
        </>)}
        {state === 'done' && (<>
          <strong>Day complete · {duration(new Date(record.check_out) - new Date(record.check_in))}</strong>
          <span className="checkin-muted">Checked in {clock(record.check_in)} · checked out {clock(record.check_out)}{record.is_late ? ' · marked late' : ''}</span>
        </>)}
        {state === 'blocked' && (<>
          <strong>Today is recorded as {record.status === 'absent' ? 'absent' : 'leave'}</strong>
          <span className="checkin-muted">{record.status === 'absent' ? 'If that is wrong, ask your manager or send a correction request below.' : 'No check-in is needed on leave.'}</span>
        </>)}
        {error && <span className="checkin-error" role="alert">{error}</span>}
      </div>

      {state === 'ready' && <button className="checkin-btn in" type="button" disabled={busy} onClick={() => act('check-in')}><FiLogIn aria-hidden="true" /> {busy ? 'Checking in…' : 'Check in'}</button>}
      {state === 'working' && <button className="checkin-btn out" type="button" disabled={busy} onClick={() => act('check-out')}><FiLogOut aria-hidden="true" /> {busy ? 'Checking out…' : 'Check out'}</button>}
    </section>
  );
}
