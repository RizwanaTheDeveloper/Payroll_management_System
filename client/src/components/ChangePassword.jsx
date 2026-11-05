import { useState } from 'react';
import { FiEye, FiEyeOff } from 'react-icons/fi';
import api from '../api';
import './ChangePassword.css';

// Shared by Settings (voluntary change) and the first-sign-in screen (required change).
export default function ChangePassword({ onChanged, heading = true, submitLabel = 'Update password' }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  const mismatch = form.confirm.length > 0 && form.newPassword !== form.confirm;
  const tooShort = form.newPassword.length > 0 && form.newPassword.length < 8;
  const pw = form.newPassword;
  const rules = [
    ['At least 8 characters', pw.length >= 8],
    ['A letter and a number', /[A-Za-z]/.test(pw) && /\d/.test(pw)],
    ['Different from your current password', pw.length > 0 && pw !== form.currentPassword],
    ['Both new passwords match', pw.length > 0 && pw === form.confirm],
  ];
  const strength = [pw.length >= 8, pw.length >= 12, /[A-Z]/.test(pw) && /[a-z]/.test(pw), /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)].filter(Boolean).length;
  const strengthLabel = !pw ? '' : ['Weak', 'Weak', 'Fair', 'Good', 'Strong'][strength];
  const ready = form.currentPassword && rules.every(([, ok]) => ok);

  async function submit(event) {
    event.preventDefault();
    if (form.newPassword.length < 8) return setStatus({ error: 'New password must be at least 8 characters.' });
    if (form.newPassword !== form.confirm) return setStatus({ error: 'New passwords do not match.' });
    setSaving(true);
    setStatus(null);
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setStatus({ ok: 'Password updated.' });
      if (onChanged) onChanged();
    } catch (err) {
      setStatus({ error: err.response?.data?.message || 'Unable to change password.' });
    } finally {
      setSaving(false);
    }
  }

  const type = visible ? 'text' : 'password';
  return (
    <form className="change-password" onSubmit={submit}>
      {heading && <h3>Change password</h3>}
      <label>Current password
        <input type={type} autoComplete="current-password" value={form.currentPassword} onChange={update('currentPassword')} required />
      </label>
      <label>New password
        <input type={type} autoComplete="new-password" minLength={8} value={form.newPassword} onChange={update('newPassword')} required aria-invalid={tooShort} />
        {pw && <span className="pw-meter" data-level={strength} aria-hidden="true"><i /><i /><i /><i /></span>}
        {pw && <small className="pw-meter-label" data-level={strength}>Strength: {strengthLabel}</small>}
      </label>
      <label>Confirm new password
        <input type={type} autoComplete="new-password" minLength={8} value={form.confirm} onChange={update('confirm')} required aria-invalid={mismatch} />
        {mismatch && <small className="is-bad">The two passwords do not match yet.</small>}
      </label>
      <ul className="pw-rules" aria-label="Password requirements">
        {rules.map(([label, ok]) => <li key={label} className={ok ? 'is-ok' : ''}>{ok ? '✓' : '○'} {label}</li>)}
      </ul>
      <button type="button" className="change-password-toggle" onClick={() => setVisible((value) => !value)}>
        {visible ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />} {visible ? 'Hide passwords' : 'Show passwords'}
      </button>
      {status?.error && <p className="change-password-msg error" role="alert">{status.error}</p>}
      {status?.ok && <p className="change-password-msg ok" role="status">{status.ok}</p>}
      <button type="submit" className="change-password-submit" disabled={saving || !ready}>{saving ? 'Saving…' : submitLabel}</button>
    </form>
  );
}
