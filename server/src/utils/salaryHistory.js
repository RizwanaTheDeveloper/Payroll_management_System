const { amount, date, fail, today } = require('./payrollValidation');
const FIELDS = ['ctc', 'basic', 'hra', 'special_allowance', 'lta', 'other_allowances', 'epf', 'professional_tax'];

async function baseline(client, employee, actorId) {
  await client.query(`INSERT INTO salary_history (employee_id, effective_from, ${FIELDS.join(',')}, actor_id, reason)
    SELECT $1, COALESCE($10::date, DATE '2000-01-01'), ${FIELDS.map((_, i) => `$${i + 2}`).join(',')}, $11, 'Initial salary structure'
    WHERE NOT EXISTS (SELECT 1 FROM salary_history WHERE employee_id = $1)`,
  [employee.id, ...FIELDS.map((key) => employee[key] || 0), employee.joining_date || null, actorId]);
}

async function recordChange(client, before, after, body, actorId) {
  await baseline(client, before, actorId);
  if (!FIELDS.some((key) => Number(before[key]) !== Number(after[key]))) return;
  const effective = body.salary_effective_from || today();
  if (!date(effective)) fail('A valid salary effective date between 2000 and 2100 is required.');
  const reason = typeof body.salary_change_reason === 'string' ? body.salary_change_reason.trim() : '';
  if (!reason || reason.length > 1000) fail('Please provide a salary change reason (up to 1000 characters).');
  const duplicate = await client.query('SELECT 1 FROM salary_history WHERE employee_id = $1 AND effective_from = $2', [before.id, effective]);
  if (duplicate.rowCount) fail('A salary version already exists for this date. Choose a different effective date.', 409);
  await client.query(`INSERT INTO salary_history (employee_id, effective_from, ${FIELDS.join(',')}, actor_id, reason)
    VALUES ($1, $2, ${FIELDS.map((_, i) => `$${i + 3}`).join(',')}, $11, $12)`,
  [before.id, effective, ...FIELDS.map((key) => amount(after[key], key)), actorId, reason]);
  // The master record reflects the most recent effective version, even for backdated changes.
  const latest = (await client.query(`SELECT * FROM salary_history WHERE employee_id = $1
    ORDER BY effective_from DESC LIMIT 1`, [before.id])).rows[0];
  await client.query(`UPDATE employees SET ${FIELDS.map((key, i) => `${key} = $${i + 2}`).join(',')} WHERE id = $1`,
    [before.id, ...FIELDS.map((key) => latest[key])]);
}

module.exports = { FIELDS, baseline, recordChange };
