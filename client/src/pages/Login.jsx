import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowRight, FiCheck, FiClock, FiEye, FiEyeOff, FiInfo, FiLock } from 'react-icons/fi';
import { FaRupeeSign } from 'react-icons/fa';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const hrEmail = import.meta.env.VITE_HR_SUPPORT_EMAIL;

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const user = await login(email.trim(), password);
      navigate(user.role === 'admin' ? '/admin' : user.role === 'manager' ? '/employee/team' : '/employee', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to sign in. Check your email and password and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="design-login">
      <section className="design-login-brand" aria-label="5 Gen Payroll">
        <div className="design-company"><span className="design-logo" aria-hidden="true">5G</span><div><strong>5 Gen Payroll</strong><span>5 Gen Educon Private Limited</span></div></div>
        <div className="design-brand-message">
          <h1>Payroll and work,<br />in one place.</h1>
          <p>Manage your workday, access your payslips and keep every request in view.</p>
          <ul className="design-brand-benefits">
            <li><span className="benefit-icon blue"><FaRupeeSign /></span>Clear salary details</li>
            <li><span className="benefit-icon mint"><FiClock /></span>Attendance and leave</li>
            <li><span className="benefit-icon lavender"><FiCheck /></span>Requests with a visible status</li>
          </ul>
        </div>
        <p className="design-brand-caption">For employees and approved administrators</p>
      </section>
      <section className="design-login-form-panel" aria-labelledby="sign-in-title">
        <div className="design-login-form-wrap">
          <p className="design-eyebrow">5 Gen Educon Private Limited</p>
          <h2 id="sign-in-title">Welcome back</h2>
          <p className="design-login-intro">Sign in with your work account.</p>
          <form onSubmit={submit} className="design-sign-in" aria-busy={busy}>
            <div className="design-field"><label htmlFor="login-email">Work email</label><input id="login-email" type="email" autoComplete="username" placeholder="you@company.com" required value={email} onChange={(event) => { setEmail(event.target.value); setError(''); }} disabled={busy} /></div>
            <div className="design-field"><label htmlFor="login-password">Password</label><div className="design-password-wrap"><input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" required value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} disabled={busy} /><button type="button" className="design-password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <FiEyeOff /> : <FiEye />}</button></div></div>
            <div className="design-login-options"><span><FiLock aria-hidden="true" /> Company account</span><button type="button" className="design-text-button" aria-expanded={help} aria-controls="access-help" onClick={() => setHelp(!help)}>Forgot password?</button></div>
            {error && <div className="design-alert" role="alert">{error}</div>}
            <button type="submit" className="design-sign-in-button" disabled={busy}><FiArrowRight aria-hidden="true" />{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <div className="design-access-note"><FiInfo aria-hidden="true" /><div><strong>The right workspace opens after sign-in</strong><p>Your account permissions determine what you can access.</p></div></div>
          <div className="design-hr-help">
            <p>Need access? <button type="button" className="design-text-button" aria-expanded={help} aria-controls="access-help" onClick={() => setHelp(!help)}>Contact your HR team</button></p>
            {help && <div id="access-help" className="design-help-panel" role="status"><strong>Account access and password help</strong><p>Ask your HR administrator to help restore access to your company account.</p>{hrEmail && <a href={`mailto:${hrEmail}?subject=Payroll%20account%20access`}>Email HR</a>}</div>}
          </div>
          <p className="design-login-footer">© {new Date().getFullYear()} 5 Gen Educon Private Limited</p>
        </div>
      </section>
    </div>
  );
}
