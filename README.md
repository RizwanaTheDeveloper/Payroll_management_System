# Payroll Management System (PERN)

## Setup
1. Start PostgreSQL and set `DATABASE_URL`, `JWT_SECRET`, and admin credentials in `server/.env`.
2. In `server`, run `npm install`, then `npm run db:init`. This reads `server/.env`, creates the configured database if missing (requires database creation privileges), and applies `src/schema.sql` in a transaction. It works on Windows without `psql` and can be rerun without deleting existing records.
3. Run `npm run seed` to create the admin login from `.env` (the sample employee is only created if `SEED_SAMPLE_EMPLOYEE=true`), then `npm run dev` (API on :5000).
4. In `client`, run `npm install`, then `npm run dev` (UI on :5173, proxies /api to :5000).

The database contains `employees` (including login accounts and salary structure), `payslips`, `attendance`, and `leaves`. In pgAdmin, refresh the database list and open the database named in `DATABASE_URL` → Schemas → public → Tables.

If PowerShell blocks `npm.ps1`, use `npm.cmd` for these commands (for example, `npm.cmd run db:init`).

Login with the admin email/password from `.env`, then add employees from the admin dashboard.

## Leave medical documents

Employees can attach optional medical documents while applying for leave: up to three PDF, JPG, or PNG files, each no larger than 5 MB. Admins can open and download the documents from the leave request's Reason cell. Employees can also view their own attachments in their leave history, including on mobile.

The `leave_documents` table stores filenames, file types, sizes, and the actual file contents (`BYTEA`), linked to `leaves` through `leave_id`. Requests and their documents are saved in one transaction. Document access requires login and is limited to admins and the employee who submitted the request.

For an existing installation, run `npm.cmd install` and `npm.cmd run db:init` in `server` before restarting the API. Run `npm.cmd run test:leaves` to verify uploads, document access, rejection reasons, and the leave/payroll flow in an isolated database schema.

## Individual employee reports

Employees can open **Employee → Reports** to view their own monthly attendance, leave, salary, deductions, loans, advances and payment information, with CSV and Print / Save PDF options. `/api/reports/my` scopes every source query to the employee ID from the signed login token; supplied employee IDs are ignored. Company reports remain administrator-only. **Employee → Settings** shows account information, permitted access and links to personal payroll, attendance and request updates.

Open **Admin → Reports → Employee reports** for a monthly table of employee IDs, names, attendance and leave counts, approved credit balances, and net pay. Open an employee's name or **View report** for their individual page with attendance records, leave requests and rejection reasons, payroll components and deductions, loans, salary advances, and decision activity. The selected month is preserved when moving between reports. Search and department filters, CSV exports, and Print / Save PDF are available.

Reports use existing database records. Attendance and leave counts cover the selected month; loan and advance request counts and repayments run through that month. Decision statuses reflect current records. Missing payslips show no salary amount, and unmarked attendance is excluded from unpaid day counts.

## Payroll review, salary history and payments

For an existing installation, run `npm.cmd run db:init` in `server`, then restart the API. The migration adds salary versions, payroll workflow/payment fields, calculation snapshots and an audit log. Existing payslip amounts are preserved; their initial workflow status is Draft and no salary payment is inferred.

Monthly earnings use calendar days: each salary component is weighted by the employee's employment dates and the salary version effective on each day. Unpaid leave is deducted at that day's salary rate. The existing leave allowance is retained; additional allowances, EPF and professional tax remain fixed monthly amounts rather than being automatically prorated. Unmarked attendance does not automatically reduce salary.

When changing salary components in **Employees**, provide an effective date and a reason. **Salary history** shows dated versions and who entered them. A second version on the same effective date is rejected to preserve history. Opening versions reflect the salary structure available when tracking was enabled; salary changes made before tracking cannot be reconstructed automatically. Verify historical salary versions before regenerating old payroll.

Use the **Monthly payroll checklist** to review missing salary, pending leave, elapsed weekday attendance gaps and missing punches. Attendance gaps use Monday–Friday as an advisory baseline; company holidays and alternative work schedules need review. **Payroll Preview** uses the same calculation as generation, including date proration, salary versions and deductions.

Payroll progresses **Draft → Reviewed → Finalized** from **Manage payroll**. Updates return reviewed payroll to Draft. Finalized payslips reject edits and deletion. Reopening requires a correction reason, and the audit log retains previous and updated values. Finalization checks for changed calculations and unresolved leave. Deductions exceeding 50% of gross earnings require acknowledgement; negative take-home pay is blocked during generation.

Once a payslip is finalized, record the date and transaction reference of a salary payment already made. This records payment status; it does not transfer funds. Reversing a payment record requires a reason before reopening payroll. Payment reports, employee monthly reports and CSV exports include recorded payment details. PDFs include workflow status, employment/paid days and separate unpaid-leave/additional deductions.

Inactive accounts and accounts with changed roles lose API access immediately, even if their JWT has not expired. The client returns expired or revoked sessions to sign-in.

Run `npm.cmd run test:payroll` for isolated payroll checks, alongside `test:loans`, `test:advances`, `test:leaves` and `test:reports`.

## Salary advances

Use **Admin → Advances** for the employee register, including employee IDs, names, approved advance balances, and pending amounts. **Add advance** saves an approved advance directly for a selected active employee; saving it requires no separate approval. Employees use **Employee → Advances** to request an advance and follow its status. Employee requests require admin approval or rejection with a reason, visible in the employee's decision history.

Salary advances are interest-free and recovered in one deduction from the selected recovery month or a later generated payroll. Pending and rejected requests are excluded from payroll. The database stores salary advances in `advances` with `record_type = 'salary_advance'`, while existing loans retain `record_type = 'loan'`. Decisions are saved in `advance_events`, and payroll deductions in `advance_recoveries`. Existing employee-record advances are displayed separately as earlier advances.

For an existing installation, run `npm.cmd run db:init` in `server`, then restart the API and refresh the client. Run `npm.cmd run test:advances` for the request, approval, rejection, access, payroll, and reporting checks.

## Employee loans
Open **Employee → Loans** to send a loan request and track its approval, payment, balance and payroll recovery history. Employees can access only their own requests. Open **Admin → Loans** to review and approve or reject employee requests, then record actual disbursements with payment references. Administrators cannot submit loan requests. The register includes outstanding balances, monthly recovery, a detail panel, projected instalments and an activity history. Recovery can be paused or resumed by an administrator with a recorded reason.

Run `npm.cmd run db:init` in `server` when updating an existing installation. Active, disbursed loans are recovered automatically when eligible payslips are generated, starting in the configured recovery month. The final instalment collects the remaining balance, including any rounding remainder. Updating a payslip preserves its recorded recovery; deleting it restores that balance. The payroll register links each recorded recovery to its loan. Existing employee master advances keep their joining-month deduction behavior.

Run `npm.cmd run test:loans` in `server` for the loans and payroll integration checks. They use an isolated database schema and remove it after completion.

Employees enter a monthly flat interest percentage (0-100%, up to two decimals) and a number of instalments (1-360). Interest for each instalment is calculated on the original principal, rounded to paise, and multiplied by the instalment count. INR 10,000 at 2% for 10 instalments means INR 200 monthly interest, INR 12,000 total repayment, and INR 1,200 deducted from net salary for each of 10 months. Monthly principal is rounded down to paise; the final instalment collects any remaining principal. Payroll and PDF payslips show Loan repayment (incl. interest) in deductions. Existing loans and legacy API requests without an instalment count retain their original one-time interest terms.

## Manager role

Managers are payroll employees (own attendance, leave, payslips, loans and advances; they appear in payroll runs) who also run their **direct reports** day to day. An administrator sets an account's **Role** to *Manager* and each team member's **Reports to** in **Admin -> Employees**. Managers sign in to a portal that opens on **My team**.

| Responsibility | What the manager does | Boundary |
| --- | --- | --- |
| Team dashboard | Today's present, absent, on-leave and unmarked counts, pending items, upcoming approved leave (`GET /api/team/summary`) | Own team only; no salary data |
| Attendance | View and mark or correct the team's daily and monthly attendance (`/api/attendance/*`) | Team members only; cannot mark their own attendance or anyone outside the team |
| Leave | Approve or reject team leave; a reason is required to reject (`GET /api/leaves/team`, `PATCH /api/leaves/:id/status`) | Final decision, recorded with who and when; outside requests return 404 |
| Loans and salary advances | Recommend or decline team requests with a note (`PATCH /api/loans/:id/recommendation`, same for advances) | Administrators still give the final approval and payment; an employee with a manager cannot be approved until the manager has recommended or declined |
| Team report | Monthly attendance and leave per team member, CSV and print (`GET /api/team/report`) | No salary, deduction or payslip data |

Employees with no manager, and every manager's own requests, go straight to an administrator. Administrators can still decide any leave request. An employee cannot report to themselves or in a circle, a manager with active reports cannot be changed back to an employee until the team is reassigned, and deactivating a manager releases their team to administrator approval.

Run `npm.cmd run db:init` in `server` (PostgreSQL 12+) before restarting, so the `manager` role value and the `manager_id`, leave decision and recommendation columns exist. Run `npm.cmd run test:manager` for the manager checks.

### Payroll: manager calculates, administrator approves, manager publishes

1. **Calculate** - in **Team payroll**, the manager calculates payroll for their own team only. Payslips are saved as drafts using the same calculation, attendance, leave and loan rules as administrator payroll. The manager cannot see or change anyone outside their team, or their own payslip.
2. **Submit** - drafts are submitted for approval (blocked while the employee has pending leave for the month or a negative take-home amount). Recalculating a submitted payslip returns it to draft.
3. **Approve** - an administrator opens **Manage payroll** and chooses *Approve and lock payroll*. This is the existing finalize step with all of its checks. To send it back, use *Reopen for correction* with a reason.
4. **Publish** - the manager publishes the approved payslips (one at a time or all at once). Administrators can publish too, which covers employees without a manager.

Employees see a payslip, its PDF and its figures in their reports only after it is published. Reopening an approved payslip withdraws it. Payslips already finalized before this feature existed were published automatically when the database was upgraded; unfinalized ones are hidden until they go through approval and publishing. Only administrators record payments, delete payslips or approve payroll; managers cannot download team members' payslip PDFs (they contain bank and tax details).

Note that managers do see their team's payroll amounts in **Team payroll**, unlike the dashboard and team report, which never show salary data. Run `npm.cmd run db:init` to apply the new payslip status and publishing columns.

## Sign-in, sessions and creating employee logins

**No browser storage.** Sign-in is a server-side session. `POST /api/auth/login` checks the password, stores a session in the `sessions` table (only a SHA-256 hash of the session ID) and returns an `httpOnly` cookie; the response contains the user's profile but no token. The web app keeps nothing in `localStorage`, `sessionStorage` or cookies readable by JavaScript - on every load it asks `GET /api/auth/me` who is signed in, and `POST /api/auth/logout` deletes the session on the server. Sessions last 8 hours and end immediately when the account is deactivated, its password is reset by an administrator, or the user changes their password (other devices are signed out).

- Because the browser sends the cookie automatically, every state-changing request must carry the `X-Requested-With: payroll-web` header (the web app's API client adds it) and cross-origin calls must come from an origin listed in `CLIENT_URL`.
- Same-site hosting (the dev proxy, or the API behind the web host's `/api` rewrite) works with the default `SameSite=Lax`. If the web app and API are on different sites, set `COOKIE_SAMESITE=none` (HTTPS required); browsers that block third-party cookies need the same-origin rewrite instead. Set `TRUST_PROXY=1` behind a reverse proxy.
- Scripts and service clients can still send a signed `Authorization: Bearer` token.

**After signing in** administrators open `/admin`, managers `/employee/team`, and employees `/employee`, all decided by the role stored on the account.

**Creating a login in the app.** In **Admin -> Employees**, enter the employee's email and a **temporary password** (type one, or press *Generate* and copy it). The password is stored hashed, and the employee must replace it at first sign-in; until then the API rejects everything except the change-password call. Untick *Require the employee to set their own password* to hand over a permanent password instead. The same option appears when an administrator resets a password in **Edit**, and a reset also signs the employee out everywhere. The Edit screen notes when an employee has not yet replaced their temporary password. Passwords must be at least 8 characters.

**Creating logins in bulk.** Put the roster in `server/scripts/data/employees.json` (git-ignored, because it holds personal data): employee ID, name, designation and `monthly_ctc`. Optional per-person fields: `email`, `department`, `joining_date`. Then run, from `server`:

```
npm.cmd run db:init                      # once, to add the sessions table and new columns
node scripts/import-employees.js         # dry run: lists what would be created
node scripts/import-employees.js --apply # creates the accounts
```

Each account is created with the same salary structure the Employees screen derives from annual CTC (monthly x 12; basic 40%, HRA 50% of basic, special allowance 20% of basic, LTA 10% of basic, remainder in other allowances), a salary-history baseline, role *employee*, and a random temporary password. The login email is `<employee id>@<domain>` (for example `emp002@5geneducon.com`) unless the roster gives an `email`. The script is safe to re-run: existing IDs or emails are skipped, never changed. Temporary credentials are written to `server/scripts/data/credentials-<time>.csv` (never printed or committed); share them privately and delete the file. Employees must choose their own password at first sign-in, and until then the API rejects everything except the change-password call. Fill in gender, date of birth, joining date and bank details from **Admin -> Employees**.

Run `npm.cmd run test:session` for the session checks.

## Admin and manager workflows compared with how a real company runs them

Roles follow normal payroll practice: the **line manager** handles day-to-day team decisions, the **administrator (HR / payroll)** owns policy, final approval and money, and **nobody approves their own work**.

| Step | Employee | Manager (line manager) | Administrator (HR / payroll) |
| --- | --- | --- | --- |
| Account and reporting line | Signs in, sets own password | Sees only direct reports | Creates logins, sets role, **Reports to** and temporary passwords |
| Attendance | **Checks in and out** from Home or Attendance (signing in does not mark attendance); **asks for a correction**, optionally with the missing check-in/check-out time, with a reason (up to 60 days back) | **Approves or rejects** team corrections; can mark team attendance; cannot change a month whose payroll is finalized | Handles requests for people with no manager, escalated requests, and any month (reopen payroll first) |
| Leave | Applies with documents | **Decides** team leave (reason required to reject); cannot change a finalized month | Decides leave for people with no manager; overrides when escalated |
| Loans and advances | Requests | **Recommends or declines** first | Final approval, payment and recovery; cannot approve a managed employee's request before the manager has recommended |
| Payroll | Sees only **published** payslips | **Calculates** team payroll, **submits** it, then **publishes** after approval | **Approves** (finalizes), returns with a reason, records payments |
| Controls | - | Cannot approve, finalize, pay or delete payroll; cannot act on their own pay | Audit trail on every decision (who and when) |

**Routing and escalation.** A request goes to the employee's manager first, or straight to an administrator when there is no manager. If it stays undecided for `APPROVAL_ESCALATION_DAYS` days (default 3) it is flagged *escalated* and also appears in the administrator's queue, so nothing is stuck while a manager is away. Employees can always see who a pending request is **with**.

**Live notifications.** `GET /api/notifications` returns role-specific counts of what is waiting on the signed-in person; the menus show them as badges, refreshed every 30 seconds while the tab is visible, on focus, and immediately after you act. Managers see leave, attendance requests, loan/advance recommendations, payroll drafts and approved payslips to publish. Administrators see only what is theirs to act on: unmanaged or escalated requests, recommended loans and advances, payroll awaiting approval. **Admin -> Approvals** collects these in one place.

**Audit.** Every attendance mark records who made it and when (`attendance.marked_by`, `marked_at`), including attendance created by approving leave or a correction request. Run `npm.cmd run test:approvals` for these checks.

## Check in and check out

Employees and managers record their own day with **Check in** and **Check out** on **Home** or **Attendance** (administrators have no attendance). Signing in no longer marks anyone present.

- `GET /api/attendance/today`, `POST /api/attendance/check-in`, `POST /api/attendance/check-out`. Times are Indian time and come from the server clock, never from the browser.
- The first check-in of the day sets the time and cannot be moved; a day is checked out once. Check-in is refused on days recorded as leave or absent (the person is told to ask their manager or send a correction request), and outside the employee's joining and leaving dates. A day marked present without a time by a manager takes the check-in time when the employee checks in.
- The late rule (check-in after 9:10 AM; three late days in a month cost a half day) and worked hours now use these real times. A present day with no check-out appears in the payroll checklist as a "punch to check".
- A forgotten check-in or check-out is fixed through **Request an attendance correction**, which now takes an optional check-in and check-out time. Approval by the manager (or an administrator) records the times along with the day.
- Run `npm.cmd run db:init` in `server` to add the two time columns on correction requests.

