const crypto = require('node:crypto');
const pool = require('../config/db');

// Browser sign-in is a server-side session: the database holds the session, and the
// browser only receives an opaque, httpOnly cookie. Nothing is kept in web storage.
const COOKIE = 'payroll_session';
const TTL_MS = 8 * 60 * 60 * 1000;
const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'payroll-web';

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function readToken(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === COOKIE) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

// SameSite=Lax suits a same-site deployment (the dev proxy, or the API behind the web host).
// Set COOKIE_SAMESITE=none when the web app and API are on different sites; that requires HTTPS.
function cookieOptions(maxAge = TTL_MS) {
  const sameSite = ['lax', 'strict', 'none'].includes(String(process.env.COOKIE_SAMESITE).toLowerCase())
    ? String(process.env.COOKIE_SAMESITE).toLowerCase() : 'lax';
  return { httpOnly: true, sameSite, secure: sameSite === 'none' || process.env.NODE_ENV === 'production', path: '/', maxAge };
}

async function createSession(req, res, employeeId) {
  await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO sessions (token_hash, employee_id, expires_at, user_agent)
     VALUES ($1, $2, NOW() + ($3 || ' milliseconds')::interval, $4)`,
    [hash(token), employeeId, String(TTL_MS), String(req.headers['user-agent'] || '').slice(0, 300)]
  );
  res.cookie(COOKIE, token, cookieOptions());
}

async function findSession(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT e.id, e.role FROM sessions s JOIN employees e ON e.id = s.employee_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`, [hash(token)]);
  return rows[0] || null;
}

async function destroySession(req, res) {
  const token = readToken(req);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hash(token)]);
  const { maxAge, ...options } = cookieOptions();
  res.clearCookie(COOKIE, options);
}

// Ends every session of an employee, optionally keeping the one making the request.
async function destroyEmployeeSessions(employeeId, exceptToken = null) {
  await pool.query('DELETE FROM sessions WHERE employee_id = $1 AND ($2::text IS NULL OR token_hash <> $2)',
    [employeeId, exceptToken ? hash(exceptToken) : null]);
}

module.exports = { COOKIE, CSRF_HEADER, CSRF_VALUE, readToken, createSession, findSession, destroySession, destroyEmployeeSessions };
