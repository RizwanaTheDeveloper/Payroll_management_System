import { FiShield } from 'react-icons/fi';
import ChangePassword from '../components/ChangePassword';
import { useAuth } from '../context/AuthContext';
import './FirstSignIn.css';

// Shown instead of the app until an account issued with a temporary password has chosen its own.
export default function FirstSignIn() {
  const { user, logout, passwordChanged } = useAuth();
  return (
    <main className="first-signin">
      <div className="first-signin-brand">
        <span className="design-logo" aria-hidden="true">5G</span>
        <div><strong>5 Gen Payroll</strong><span>5 Gen Educon Private Limited</span></div>
      </div>

      <section className="first-signin-card" aria-labelledby="first-signin-title">
        <div className="first-signin-head">
          <span className="first-signin-icon" aria-hidden="true"><FiShield /></span>
          <div>
            <h1 id="first-signin-title">Choose your password</h1>
            <p>Welcome, {user?.name}. You signed in with a temporary password. Set your own now to continue. Your current password is the temporary one you were given.</p>
          </div>
        </div>
        <ChangePassword heading={false} submitLabel="Save and continue" onChanged={passwordChanged} />
      </section>

      <p className="first-signin-foot">Not you? <button type="button" onClick={logout}>Sign out</button></p>
    </main>
  );
}
