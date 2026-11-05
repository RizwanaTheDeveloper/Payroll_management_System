import { createContext, useContext, useEffect, useState } from 'react';

import api from '../api';

const Ctx = createContext();

export const useAuth = () => useContext(Ctx);

// The signed-in user always comes from the backend (GET /auth/me); the browser keeps no copy.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get('/auth/me')
      .then(({ data }) => { if (!cancelled) setUser(data.user); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const expireSession = () => setUser(null);
    window.addEventListener('payroll:session-expired', expireSession);
    return () => window.removeEventListener('payroll:session-expired', expireSession);
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setUser(data.user);
    return data.user;
  };

  // Called after the required first-login password change so the app can proceed.
  const passwordChanged = () => {
    setUser((current) => (current ? { ...current, must_change_password: false } : current));
  };

  const logout = async () => {
    setUser(null);
    try { await api.post('/auth/logout'); } catch { /* the session also expires on the server */ }
  };

  return (
    <Ctx.Provider value={{ user, loading, login, logout, passwordChanged }}>
      {children}
    </Ctx.Provider>
  );
}
