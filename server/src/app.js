require('./config/env');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pool = require('./config/db');

const app = express();

// Set TRUST_PROXY=1 when deployed behind a reverse proxy so rate limiting sees real client IPs.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

app.use(helmet());

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(cors({
  credentials: true,
  // Lets the browser read the payslip file name from the download response.
  exposedHeaders: ['Content-Disposition'],
  origin: function (origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    const error = new Error('Not allowed by CORS');
    error.status = 403;
    return callback(error);
  },
}));

app.use(express.json({ limit: '1mb' }));

// Health check / root route
app.get('/', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'API is running' });
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'OK', database: 'up' });
  } catch (error) {
    res.status(503).json({ status: 'DEGRADED', database: 'down' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/payslips', require('./routes/payslips'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/leaves', require('./routes/leaves'));
app.use('/api/advances', require('./routes/advances'));
app.use('/api/loans', require('./routes/loans'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/team', require('./routes/team'));
app.use('/api/attendance-requests', require('./routes/attendanceRequests'));
app.use('/api/notifications', require('./routes/notifications'));

// After an uncaught error the process state is unknown: log and exit so the
// supervisor (nodemon, pm2, the host) restarts it cleanly.
process.on('uncaughtException', (err) => { console.error('UNCAUGHT:', err); process.exit(1); });
process.on('unhandledRejection', (err) => { console.error('UNHANDLED:', err); process.exit(1); });

app.use('*', (req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
});

// Central error handler: honours error.status (CORS, malformed JSON, ...) and
// never leaks internals for unexpected failures.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('REQUEST ERROR:', err);
  res.status(status).json({
    message: status >= 500 ? 'Something went wrong. Please try again.' : err.message,
  });
});

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is missing. Set a private signing secret in server/.env before starting the API.');
}

const port = process.env.PORT || 5000;
const server = app.listen(port, () =>
  console.log(`API running on port ${port}`)
);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the existing server before starting this API again.`);
  } else {
    console.error('API failed to start:', err);
  }

  process.exit(1);
});
