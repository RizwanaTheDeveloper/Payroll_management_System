const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const session = require('../utils/session');

exports.authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  let viaCookie = false;

  if (authHeader) {
    // Service clients and scripts may still present a signed bearer token.
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
    if (!token) return res.status(401).json({ message: 'No token' });
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({ message: 'Invalid token' });
    }
  } else {
    // Browsers authenticate with the server-side session cookie.
    const token = session.readToken(req);
    if (!token) return res.status(401).json({ message: 'Please sign in.' });
    try {
      const found = await session.findSession(token);
      if (!found) return res.status(401).json({ message: 'Your session has ended. Please sign in again.' });
      req.user = { id: found.id, role: found.role };
    } catch (error) { return next(error); }
    viaCookie = true;
    // Cookies are sent automatically, so unsafe requests must carry a header that
    // cross-site pages cannot add without passing the CORS allow-list.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get(session.CSRF_HEADER) !== session.CSRF_VALUE) {
      return res.status(403).json({ message: 'Missing request header.' });
    }
  }

  try {
    const { rows } = await pool.query('SELECT role, is_active, must_change_password FROM employees WHERE id = $1', [req.user.id]);
    if (!rows[0]?.is_active || rows[0].role !== req.user.role) {
      return res.status(401).json({ message: 'Your account access has changed. Please sign in again.' });
    }
    // Until the temporary password is replaced, only the change-password call is allowed.
    const path = req.originalUrl.split('?')[0];
    if (rows[0].must_change_password && !path.endsWith('/auth/change-password')) {
      return res.status(403).json({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Please set a new password before continuing.' });
    }
    req.viaSession = viaCookie;
    next();
  } catch (error) { next(error); }
};

exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'Forbidden'
      });
    }

    next();
  };
};
