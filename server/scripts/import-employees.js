// Creates employee accounts (login + salary structure) from scripts/data/employees.json.
//
//   node scripts/import-employees.js            # dry run: shows what would be created
//   node scripts/import-employees.js --apply    # creates the accounts
//
// Safe to re-run: employees whose ID or email already exists are skipped, never changed.
// Each new account gets a random temporary password and must choose its own at first sign-in.
// Credentials are written to scripts/data/credentials-<timestamp>.csv (git-ignored); they are
// never printed or committed.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const pool = require('../src/config/db');
const { LOCK } = require('../src/utils/loanRecovery');
const { baseline } = require('../src/utils/salaryHistory');

const apply = process.argv.includes('--apply');
const rosterPath = path.resolve(__dirname, process.env.ROSTER_FILE || 'data/employees.json');

// Same structure the Employees screen derives from annual CTC.
function salaryFromCtc(annualCtc) {
  const monthly = annualCtc / 12;
  const round2 = (value) => Number(value.toFixed(2));
  const basic = monthly * 0.4;
  const hra = basic * 0.5;
  const special = basic * 0.2;
  const lta = basic * 0.1;
  return {
    ctc: annualCtc,
    // Andhra Pradesh: EPF 12% of basic (wage cap 15,000); professional tax slabs on monthly gross.
    epf: Math.round(Math.min(basic, 15000) * 0.12),
    professional_tax: monthly > 20000 ? 200 : monthly > 15000 ? 150 : 0,
    basic: round2(basic),
    hra: round2(hra),
    special_allowance: round2(special),
    lta: round2(lta),
    other_allowances: round2(monthly - basic - hra - special - lta),
  };
}

function temporaryPassword() {
  // 12 characters from an alphabet without look-alikes (no 0/O, 1/l/I).
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(12), (byte) => alphabet[byte % alphabet.length]).join('');
}

const csvCell = (value) => `"${String(value).replace(/"/g, '""')}"`;

async function main() {
  const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
  const domain = roster.domain;
  const seen = new Set();
  const plan = roster.employees.map((row) => {
    const empCode = String(row.emp_code || '').trim().toUpperCase();
    const monthly = Number(row.monthly_ctc);
    if (!empCode || !String(row.name || '').trim() || !String(row.designation || '').trim()) {
      throw new Error(`Roster row is missing an ID, name or designation: ${JSON.stringify(row)}`);
    }
    if (!Number.isFinite(monthly) || monthly <= 0) throw new Error(`${empCode}: monthly_ctc must be a positive number`);
    // Login email: explicit "email" in the roster, otherwise the employee ID at the company domain.
    const email = String(row.email || `${empCode.toLowerCase()}@${domain}`).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`${empCode}: invalid email ${email}`);
    if (seen.has(empCode) || seen.has(email)) throw new Error(`${empCode}: duplicate ID or email in the roster`);
    seen.add(empCode); seen.add(email);
    return { empCode, email, name: String(row.name).trim(), designation: String(row.designation).trim(),
      department: row.department ? String(row.department).trim() : null,
      joining_date: row.joining_date || null,
      ...salaryFromCtc(Math.round(monthly * 12)) };
  });

  const created = [];
  const skipped = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(LOCK);
    for (const item of plan) {
      const exists = await client.query('SELECT emp_code, email FROM employees WHERE emp_code = $1 OR LOWER(email) = $2',
        [item.empCode, item.email]);
      if (exists.rowCount) {
        skipped.push(`${item.empCode} (${exists.rows[0].emp_code === item.empCode ? 'ID' : 'email'} already exists)`);
        continue;
      }
      const password = temporaryPassword();
      if (apply) {
        const hash = await bcrypt.hash(password, 10);
        const { rows } = await client.query(`INSERT INTO employees
          (emp_code, name, email, password_hash, role, designation, department, joining_date, tax_regime,
           ctc, basic, hra, special_allowance, lta, other_allowances, epf, professional_tax, is_active, must_change_password)
          VALUES ($1,$2,$3,$4,'employee',$5,$6,$7,'new',$8,$9,$10,$11,$12,$13,$14,$15,TRUE,TRUE) RETURNING *`,
        [item.empCode, item.name, item.email, hash, item.designation, item.department, item.joining_date,
          item.ctc, item.basic, item.hra, item.special_allowance, item.lta, item.other_allowances, item.epf, item.professional_tax]);
        await baseline(client, rows[0], null);
      }
      created.push({ ...item, password });
    }
    if (apply) await client.query('COMMIT'); else await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }

  const money = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  console.log(`${apply ? 'Created' : 'Would create'} ${created.length} account(s); skipped ${skipped.length}.`);
  for (const item of created) {
    console.log(`  ${item.empCode}  ${item.name.padEnd(24)} ${item.designation.padEnd(18)} ${item.email.padEnd(32)} annual CTC ${money(item.ctc)}`);
  }
  if (skipped.length) console.log(`Skipped (already exist): ${skipped.join(', ')}`);

  if (apply && created.length) {
    const file = path.resolve(__dirname, `data/credentials-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    const lines = ['Employee ID,Name,Login email,Temporary password,Opens'];
    for (const item of created) lines.push([item.empCode, item.name, item.email, item.password, '/employee'].map(csvCell).join(','));
    fs.writeFileSync(file, `${lines.join('\r\n')}\r\n`, { mode: 0o600 });
    console.log(`Temporary credentials saved to ${file}`);
    console.log('Share each password privately, then delete the file. Employees must change it at first sign-in.');
  } else if (!apply) {
    console.log('Dry run only. Re-run with --apply to create the accounts.');
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
