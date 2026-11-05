-- =========================================================
-- PAYROLL MANAGEMENT SYSTEM
-- PostgreSQL Database Schema
-- =========================================================

-- =========================================================
-- ENUMS
-- =========================================================

DO $$
BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'employee');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE leave_status AS ENUM (
    'pending',
    'approved',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- =========================================================
-- EMPLOYEES
-- =========================================================

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,

  emp_code VARCHAR(50) UNIQUE NOT NULL,

  name VARCHAR(100) NOT NULL,

  email VARCHAR(150) UNIQUE NOT NULL,

  password_hash TEXT NOT NULL,

  role user_role NOT NULL DEFAULT 'employee',

  designation VARCHAR(100),

  department VARCHAR(100),

  gender VARCHAR(20),

  dob DATE,

  ctc NUMERIC(12,2) NOT NULL DEFAULT 0,

  advance NUMERIC(12,2) DEFAULT 0,

  tax_regime VARCHAR(10) NOT NULL DEFAULT 'old'
    CHECK (tax_regime IN ('old', 'new')),

  pan VARCHAR(10),

  pf_uan VARCHAR(12),

  account_number VARCHAR(18),

  ifsc_code VARCHAR(11),

  joining_date DATE,

  resignation_date DATE,

  -- =======================================================
  -- MONTHLY SALARY STRUCTURE - EARNINGS
  -- =======================================================

  basic NUMERIC(12,2) NOT NULL DEFAULT 0,

  hra NUMERIC(12,2) NOT NULL DEFAULT 0,

  special_allowance NUMERIC(12,2) NOT NULL DEFAULT 0,

  lta NUMERIC(12,2) NOT NULL DEFAULT 0,

  other_allowances NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- =======================================================
  -- MONTHLY DEDUCTIONS
  -- =======================================================

  epf NUMERIC(12,2) NOT NULL DEFAULT 0,

  professional_tax NUMERIC(12,2) NOT NULL DEFAULT 0,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);


-- =========================================================
-- PAYSLIPS
-- =========================================================

CREATE TABLE IF NOT EXISTS payslips (
  id SERIAL PRIMARY KEY,

  employee_id INT NOT NULL
    REFERENCES employees(id)
    ON DELETE CASCADE,

  month INT NOT NULL
    CHECK (month BETWEEN 1 AND 12),

  year INT NOT NULL,

  -- =======================================================
  -- EARNINGS
  -- =======================================================

  basic NUMERIC(12,2) NOT NULL DEFAULT 0,

  hra NUMERIC(12,2) NOT NULL DEFAULT 0,

  special_allowance NUMERIC(12,2) NOT NULL DEFAULT 0,

  lta NUMERIC(12,2) NOT NULL DEFAULT 0,

  other_allowances NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Additional allowance entered during payroll generation
  allowances NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- =======================================================
  -- DEDUCTIONS
  -- =======================================================

  epf NUMERIC(12,2) NOT NULL DEFAULT 0,

  professional_tax NUMERIC(12,2) NOT NULL DEFAULT 0,

  advance NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Additional deduction entered during payroll generation
  deductions NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- =======================================================
  -- FINAL
  -- =======================================================

  net_pay NUMERIC(12,2) NOT NULL DEFAULT 0,

  generated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (employee_id, month, year)
);


-- =========================================================
-- ATTENDANCE
-- =========================================================

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,

  employee_id INT NOT NULL
    REFERENCES employees(id)
    ON DELETE CASCADE,

  work_date DATE NOT NULL DEFAULT CURRENT_DATE,

  status VARCHAR(20)
    CHECK (status IN ('present', 'absent', 'leave', 'paid_leave')),

  day_type VARCHAR(10)
    NOT NULL DEFAULT 'full'
    CHECK (day_type IN ('full', 'half')),

  note TEXT,

  check_in TIMESTAMP,

  check_out TIMESTAMP,

  UNIQUE (employee_id, work_date)
);


-- =========================================================
-- LEAVES
-- =========================================================

CREATE TABLE IF NOT EXISTS leaves (
  id SERIAL PRIMARY KEY,

  employee_id INT NOT NULL
    REFERENCES employees(id)
    ON DELETE CASCADE,

  leave_type VARCHAR(30) NOT NULL,

  start_date DATE NOT NULL,

  end_date DATE NOT NULL,

  reason TEXT,

  status leave_status NOT NULL DEFAULT 'pending',

  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE leaves ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

CREATE TABLE IF NOT EXISTS leave_documents (
  id SERIAL PRIMARY KEY,
  leave_id INT NOT NULL REFERENCES leaves(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(50) NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes INT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  content BYTEA NOT NULL CHECK (octet_length(content) = size_bytes),
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leave_documents_leave_id_idx ON leave_documents(leave_id);


-- =========================================================
-- MIGRATION SAFETY
-- =========================================================
CREATE TABLE IF NOT EXISTS advances (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  instalment NUMERIC(12,2) NOT NULL CHECK (instalment > 0 AND instalment <= amount),
  first_recovery DATE NOT NULL CHECK (EXTRACT(DAY FROM first_recovery) = 1),
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'active', 'paused', 'rejected')),
  disbursed_on DATE,
  payment_reference VARCHAR(150),
  created_by INT REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status IN ('active', 'paused')) = (disbursed_on IS NOT NULL)),
  CHECK (disbursed_on IS NULL OR payment_reference IS NOT NULL)
);

-- Keep existing advance records and recoveries when upgrading to loans.
ALTER TABLE advances
  ADD COLUMN IF NOT EXISTS record_type VARCHAR(20) NOT NULL DEFAULT 'loan'
    CHECK (record_type IN ('loan', 'salary_advance'));
CREATE INDEX IF NOT EXISTS advances_record_type_idx ON advances(record_type);

ALTER TABLE advances
  ADD COLUMN IF NOT EXISTS interest_percentage NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (interest_percentage >= 0 AND interest_percentage <= 100);
-- NULL preserves the terms of loans created before monthly flat interest.
ALTER TABLE advances
  ADD COLUMN IF NOT EXISTS instalment_count INT
    CHECK (instalment_count BETWEEN 1 AND 360);
ALTER TABLE advances DROP CONSTRAINT IF EXISTS advances_instalment_check;
-- PostgreSQL names the original cross-column instalment check advances_check.
ALTER TABLE advances DROP CONSTRAINT IF EXISTS advances_check;
ALTER TABLE advances ADD CONSTRAINT advances_instalment_check
  CHECK (instalment > 0 AND instalment <= amount + ROUND(amount * interest_percentage / 100, 2) * COALESCE(instalment_count, 1));

CREATE TABLE IF NOT EXISTS advance_recoveries (
  id SERIAL PRIMARY KEY,
  advance_id INT NOT NULL REFERENCES advances(id) ON DELETE CASCADE,
  payslip_id INT NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  UNIQUE (advance_id, payslip_id)
);
CREATE INDEX IF NOT EXISTS advance_recoveries_advance_idx ON advance_recoveries(advance_id);
CREATE INDEX IF NOT EXISTS advances_employee_idx ON advances(employee_id);

CREATE TABLE IF NOT EXISTS advance_events (
  id SERIAL PRIMARY KEY,
  advance_id INT NOT NULL REFERENCES advances(id) ON DELETE CASCADE,
  actor_id INT REFERENCES employees(id) ON DELETE SET NULL,
  action VARCHAR(30) NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- If your existing database already exists, the following
-- statements safely add the new columns.
-- =========================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS epf NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('present', 'absent', 'leave', 'paid_leave'));

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS professional_tax NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS advance NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE employees
  ALTER COLUMN advance DROP NOT NULL;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS bank_branch VARCHAR(100);

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS hra NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS special_allowance NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS lta NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS other_allowances NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Effective-dated structures and immutable payroll calculation snapshots.
CREATE TABLE IF NOT EXISTS salary_history (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  effective_from DATE NOT NULL,
  ctc NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (ctc >= 0),
  basic NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (basic >= 0),
  hra NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (hra >= 0),
  special_allowance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (special_allowance >= 0),
  lta NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (lta >= 0),
  other_allowances NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (other_allowances >= 0),
  epf NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (epf >= 0),
  professional_tax NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (professional_tax >= 0),
  actor_id INT REFERENCES employees(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, effective_from)
);

INSERT INTO salary_history (employee_id, effective_from, ctc, basic, hra, special_allowance,
  lta, other_allowances, epf, professional_tax, reason)
SELECT id, '2000-01-01', ctc, basic, hra, special_allowance, lta, other_allowances,
  epf, professional_tax, 'Opening structure when salary tracking was enabled'
FROM employees e WHERE role = 'employee' AND NOT EXISTS (SELECT 1 FROM salary_history h WHERE h.employee_id = e.id);

UPDATE salary_history h
SET effective_from = e.joining_date
FROM employees e
WHERE h.employee_id = e.id
  AND h.reason = 'Initial salary structure'
  AND e.joining_date IS NOT NULL
  AND h.effective_from <> e.joining_date
  AND NOT EXISTS (
    SELECT 1 FROM salary_history existing
    WHERE existing.employee_id = h.employee_id
      AND existing.effective_from = e.joining_date
  );

ALTER TABLE payslips ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft', 'reviewed', 'finalized'));
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid', 'paid'));
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS paid_on DATE;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(150);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS reviewed_by INT REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS finalized_by INT REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS unpaid_leave_deduction NUMERIC(12,2);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS additional_deductions NUMERIC(12,2);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS late_login_deduction NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS late_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS late_login_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS month_days INT;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employed_days NUMERIC(5,2);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS net_paid_days NUMERIC(5,2);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS calculation_snapshot JSONB;

CREATE TABLE IF NOT EXISTS payroll_events (
  id SERIAL PRIMARY KEY,
  payslip_id INT REFERENCES payslips(id) ON DELETE SET NULL,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  month INT NOT NULL,
  year INT NOT NULL,
  actor_id INT REFERENCES employees(id) ON DELETE SET NULL,
  action VARCHAR(30) NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  before_snapshot JSONB,
  after_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payroll_events_period_idx ON payroll_events(year, month, employee_id);

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS epf NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS professional_tax NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS advance NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Lookup indexes for per-employee and per-period queries (reports, payroll, leave).
CREATE INDEX IF NOT EXISTS payslips_period_idx ON payslips(year, month);
CREATE INDEX IF NOT EXISTS attendance_work_date_idx ON attendance(work_date);
CREATE INDEX IF NOT EXISTS leaves_employee_idx ON leaves(employee_id, start_date);

-- =========================================================
-- MANAGER ROLE
-- Managers are payroll employees who also approve leave for their direct reports.
-- (The new enum value is not referenced elsewhere in this file, so this is safe
-- inside the single transaction used by db:init on PostgreSQL 12+.)
-- =========================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'manager';

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS manager_id INT REFERENCES employees(id) ON DELETE SET NULL;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_manager_not_self;
ALTER TABLE employees
  ADD CONSTRAINT employees_manager_not_self CHECK (manager_id IS NULL OR manager_id <> id);

CREATE INDEX IF NOT EXISTS employees_manager_idx ON employees(manager_id);

ALTER TABLE leaves ADD COLUMN IF NOT EXISTS decided_by INT REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

-- Manager recommendation on loan and salary-advance requests (admin gives final approval).
ALTER TABLE advances ADD COLUMN IF NOT EXISTS manager_decision VARCHAR(20)
  CHECK (manager_decision IN ('recommended', 'declined'));
ALTER TABLE advances ADD COLUMN IF NOT EXISTS manager_note TEXT;
ALTER TABLE advances ADD COLUMN IF NOT EXISTS manager_decided_by INT REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE advances ADD COLUMN IF NOT EXISTS manager_decided_at TIMESTAMPTZ;

-- =========================================================
-- MANAGER PAYROLL WORKFLOW
-- Manager calculates (draft) -> submits -> admin approves (finalized) -> manager publishes.
-- Employees only see payslips that have been published.
-- =========================================================

ALTER TABLE payslips DROP CONSTRAINT IF EXISTS payslips_status_check;
ALTER TABLE payslips ADD CONSTRAINT payslips_status_check
  CHECK (status IN ('draft', 'submitted', 'reviewed', 'finalized'));

ALTER TABLE payslips ADD COLUMN IF NOT EXISTS submitted_by INT REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS published_by INT REFERENCES employees(id) ON DELETE SET NULL;

-- Payslips that were already finalized before publishing existed stay visible to employees.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'payslips' AND column_name = 'published_at'
  ) THEN
    ALTER TABLE payslips ADD COLUMN published_at TIMESTAMPTZ;
    UPDATE payslips SET published_at = COALESCE(finalized_at, updated_at, NOW()) WHERE status = 'finalized';
  END IF;
END $$;

-- Accounts created with a generated password must choose their own at first sign-in.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Server-side browser sessions (the browser holds only an opaque httpOnly cookie).
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_employee_idx ON sessions(employee_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

-- =========================================================
-- APPROVAL WORKFLOWS: attendance audit trail and regularization requests
-- =========================================================

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS marked_by INT REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS marked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS attendance_requests (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  day_type VARCHAR(10) NOT NULL DEFAULT 'full' CHECK (day_type IN ('full', 'half')),
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by INT REFERENCES employees(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_requests_one_pending
  ON attendance_requests(employee_id, work_date) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS attendance_requests_status_idx ON attendance_requests(status, created_at);
CREATE INDEX IF NOT EXISTS attendance_requests_employee_idx ON attendance_requests(employee_id);

-- Optional check-in / check-out times on attendance correction requests.
ALTER TABLE attendance_requests ADD COLUMN IF NOT EXISTS check_in_time TIME;
ALTER TABLE attendance_requests ADD COLUMN IF NOT EXISTS check_out_time TIME;
