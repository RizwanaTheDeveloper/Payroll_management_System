import { useEffect, useState } from 'react';
import api from '../api';

const POLL_MS = 30000;
export const REFRESH_EVENT = 'payroll:refresh-notifications';

// Live "waiting on me" counts from the backend. Polls while the tab is visible, refreshes when the
// tab regains focus, and refreshes immediately after the user acts (dispatch REFRESH_EVENT).
export default function useNotifications() {
  const [counts, setCounts] = useState({});

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      api.get('/notifications')
        .then(({ data }) => { if (!cancelled) setCounts(data.counts || {}); })
        .catch(() => { /* badges are best-effort */ });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    window.addEventListener('focus', load);
    window.addEventListener(REFRESH_EVENT, load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
      window.removeEventListener('focus', load);
      window.removeEventListener(REFRESH_EVENT, load);
    };
  }, []);

  return counts;
}

export const refreshNotifications = () => window.dispatchEvent(new Event(REFRESH_EVENT));
