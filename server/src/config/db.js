require('./env');

const { Client, Pool } = require('pg');

const config = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {};

// Hosted PostgreSQL (Render, etc.) only accepts TLS connections from outside its network and
// drops idle ones, which surfaces as "read ECONNRESET". Use TLS for any non-local host
// (override with DATABASE_SSL=false/true; set DATABASE_SSL_STRICT=true to verify the certificate)
// and keep pooled connections alive. An sslmode in DATABASE_URL still takes precedence.
let databaseHost = process.env.PGHOST || '';
try { if (config.connectionString) databaseHost = new URL(config.connectionString).hostname; } catch { /* validated below */ }
const isLocalHost = ['', 'localhost', '127.0.0.1', '::1', '[::1]'].includes(databaseHost);
const useSsl = process.env.DATABASE_SSL ? process.env.DATABASE_SSL !== 'false' : !isLocalHost;
if (useSsl) config.ssl = { rejectUnauthorized: process.env.DATABASE_SSL_STRICT === 'true' };
config.keepAlive = true;
config.keepAliveInitialDelayMillis = 10000;
config.idleTimeoutMillis = 20000;
config.connectionTimeoutMillis = 15000;
config.max = 10;

if (config.connectionString) {
  try {
    const url = new URL(config.connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      throw new Error('Unsupported database URL');
    }
  } catch {
    throw new Error('DATABASE_URL must be a valid postgres:// or postgresql:// connection URL in server/.env.');
  }
}

// Inspect the same configuration pg will use, including PGPASSWORD fallback.
let parameters;
try {
  parameters = new Client(config).connectionParameters;
} catch {
  throw new Error('Unable to read PostgreSQL configuration. Check DATABASE_URL in server/.env.');
}
if (typeof parameters.password !== 'string' || !parameters.password) {
  throw new Error('PostgreSQL password is missing. Set DATABASE_URL with your database password, or set PGPASSWORD, in server/.env.');
}

const pool = new Pool(config);

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

module.exports = pool;
