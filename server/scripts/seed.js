require('../src/config/env');
const bcrypt = require('bcrypt');
const pool = require('../src/config/db');

async function seedUser({ empCode, name, email, password, role, designation }) {
  if (!email || !password) {
    console.warn(`Skipped ${role}: email or password missing in .env`);
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO employees (emp_code, name, email, password_hash, role, designation)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO NOTHING`,
    [empCode, name, email, hash, role, designation]
  );
  console.log(`${role} ready:`, email);
}

(async () => {
  try {
    const {
      ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD,
      EMPLOYEE_NAME, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD,
    } = process.env;

    await seedUser({
      empCode: process.env.ADMIN_EMP_CODE || 'ADMIN-001',
      name: ADMIN_NAME || 'Admin',
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: 'admin',
      designation: 'Administrator',
    });

    // The sample employee is for trying the app out only. Real employees are created in
    // Admin -> Employees (or with scripts/import-employees.js), so it is opt-in.
    if (process.env.SEED_SAMPLE_EMPLOYEE === 'true') {
      await seedUser({
        empCode: process.env.EMPLOYEE_EMP_CODE || 'EMP-001',
        name: EMPLOYEE_NAME || 'Employee',
        email: EMPLOYEE_EMAIL,
        password: EMPLOYEE_PASSWORD,
        role: 'employee',
        designation: 'Employee',
      });
    } else {
      console.log('Sample employee not created (set SEED_SAMPLE_EMPLOYEE=true to create it).');
    }
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
