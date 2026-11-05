const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const session = require('../utils/session');

const bcrypt = require('bcrypt');
const pool = require('../config/db');

// Slows password guessing: 10 failed attempts per IP+email per 15 minutes.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').trim().toLowerCase()}`,
  validate: { keyGeneratorIpFallback: false },
  message: { message: 'Too many sign-in attempts. Please try again in 15 minutes.' },
});

const publicUser = (row) => ({
  id: row.id,
  name: row.name,
  role: row.role,
  emp_code: row.emp_code,
  designation: row.designation,
  must_change_password: row.must_change_password,
});

// GET /api/auth/me - who is signed in (the browser keeps no copy of this)
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, role, emp_code, designation, must_change_password FROM employees WHERE id = $1',
      [req.user.id]
    );
    res.json({ user: publicUser(rows[0]) });
  } catch (error) {
    console.error('ME ERROR:', error);
    res.status(500).json({ message: 'Unable to load your account' });
  }
});

// POST /api/auth/logout - ends the server-side session
router.post('/logout', async (req, res) => {
  try {
    await session.destroySession(req, res);
    res.json({ message: 'Signed out' });
  } catch (error) {
    console.error('LOGOUT ERROR:', error);
    res.status(500).json({ message: 'Unable to sign out' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const rawEmail = req.body?.email;
    const password = req.body?.password;

    const email =
      typeof rawEmail === 'string'
        ? rawEmail.trim().toLowerCase()
        : '';

    if (!email || !password) {
      return res.status(400).json({
        message: 'Email and password are required'
      });
    }

    const { rows } = await pool.query(
      `
        SELECT *
        FROM employees
        WHERE LOWER(email) = $1
          AND is_active = TRUE
        LIMIT 1
      `,
      [email]
    );

    const user = rows[0];

    if (!user) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    const passwordMatch = await bcrypt.compare(
      String(password),
      user.password_hash
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    await session.createSession(req, res, user.id);

    return res.json({
      user: publicUser(user)
    });

  } catch (error) {
    console.error('LOGIN ERROR:', error);

    return res.status(500).json({
      message: 'Login failed'
    });
  }
});

// POST /api/auth/change-password  { currentPassword, newPassword }
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ message: 'New password must differ from the current password' });
    }

    const { rows } = await pool.query('SELECT password_hash FROM employees WHERE id = $1', [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE employees SET password_hash = $1, must_change_password = FALSE WHERE id = $2', [hash, req.user.id]);
    // Other devices must sign in again with the new password.
    await session.destroyEmployeeSessions(req.user.id, session.readToken(req));
    res.json({ message: 'Password updated' });
  } catch (error) {
    console.error('CHANGE PASSWORD ERROR:', error);
    res.status(500).json({ message: 'Unable to change password' });
  }
});

module.exports = router;
