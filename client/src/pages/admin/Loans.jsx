import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FiClock, FiInfo, FiRefreshCw, FiRepeat, FiSearch, FiX } from "react-icons/fi";
import { FaRupeeSign } from "react-icons/fa";
import api from "../../api";
import LoanRepaymentTotal from "../../components/LoanRepaymentTotal";
import { scheduledLoanDeductions } from "../../utils/payrollDeductions";

const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const periodName = (value) =>
  new Date(`${value.slice(0, 7)}-01T12:00:00`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
const dateName = (value) =>
  value
    ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Not yet paid";
const label = (value) => value[0].toUpperCase() + value.slice(1);
const actions = {
  approve: "Approve loan",
  reject: "Reject request",
  disburse: "Record disbursement",
  pause: "Pause recovery",
  resume: "Resume recovery",
};
const eventNames = {
  created: "Request submitted",
  approve: "Approved",
  reject: "Rejected",
  disburse: "Payment recorded",
  pause: "Recovery paused",
  resume: "Recovery resumed",
  manager_recommend: "Manager recommended",
  manager_decline: "Manager declined",
};

function EmployeeSearch({ employees, value, onChange, loading }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const optionList = useRef(null);
  useEffect(() => {
    if (open && activeIndex >= 0)
      optionList.current?.children[activeIndex]?.scrollIntoView({
        block: "nearest",
      });
  }, [open, activeIndex]);
  const selected = employees.find((employee) => String(employee.id) === value);
  const matches = employees.filter((employee) =>
    `${employee.name} ${employee.emp_code}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const options = [{ id: "all", name: "All employees" }, ...matches];
  function choose(employee) {
    onChange(String(employee.id));
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }
  function onKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        (current) => (current + direction + options.length) % options.length,
      );
    } else if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      choose(options[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      setActiveIndex(-1);
    }
  }
  return (
    <div className="loan-search loan-employee-search">
      <label htmlFor="loan-employee-search">Search employees</label>
      <div>
        <FiSearch aria-hidden="true" />
        <input
          id="loan-employee-search"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="loan-employee-options"
          aria-activedescendant={
            open && activeIndex >= 0
              ? `loan-employee-option-${activeIndex}`
              : undefined
          }
          placeholder={
            loading ? "Loading employees…" : "Select or search any employee"
          }
          disabled={loading && !employees.length}
          value={
            open
              ? query
              : selected
                ? `${selected.name} - ${selected.emp_code}`
                : ""
          }
          onFocus={() => {
            setOpen(true);
            setQuery("");
            setActiveIndex(-1);
          }}
          onClick={() => {
            if (!open) {
              setOpen(true);
              setQuery("");
              setActiveIndex(-1);
            }
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onBlur={() => {
            setOpen(false);
            setQuery("");
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
        />
        {open && (
          <div className="loan-employee-dropdown">
            <div
              ref={optionList}
              id="loan-employee-options"
              role="listbox"
              aria-label="Employees"
            >
              {options.map((employee, index) => (
                <button
                  type="button"
                  role="option"
                  tabIndex={-1}
                  id={`loan-employee-option-${index}`}
                  key={employee.id}
                  aria-selected={String(employee.id) === value}
                  className={activeIndex === index ? "is-highlighted" : ""}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(employee)}
                >
                  <strong>{employee.name}</strong>
                  {employee.emp_code && <small>{employee.emp_code}</small>}
                </button>
              ))}
            </div>
            {!matches.length && (
              <p role="status">
                {employees.length
                  ? "No matching employees."
                  : "No employees in the employee list."}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LoanDialog({ mode, selected, onClose, onSaved }) {
  const dialog = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    note: "",
    disbursed_on: today(),
    payment_reference: "",
  });
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => previous?.focus();
  }, []);
  const field = (key) => ({
    value: form[key],
    onChange: (event) => setForm({ ...form, [key]: event.target.value }),
  });
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.patch(`/loans/${selected.id}/status`, {
        ...form,
        action: mode,
      });
      onSaved(selected.id);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to save the loan. Please try again.",
      );
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="loan-dialog"
      aria-labelledby="loan-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="loan-panel-head">
          <h2 id="loan-dialog-title">{actions[mode]}</h2>
          <button
            type="button"
            className="loan-icon-button"
            aria-label="Close dialog"
            disabled={busy}
            onClick={onClose}
          >
            <FiX />
          </button>
        </div>
        <div className="loan-dialog-body">
          {error && (
            <p className="loan-error" role="alert">
              {error}
            </p>
          )}
          <>
            <div className="loan-confirm">
              <strong>
                {selected.name} · {selected.emp_code}
              </strong>
              <span>
                {money(selected.amount)} loan at {selected.interest_percentage}%{" "}
                {selected.instalment_count ? "monthly" : "one-time"} interest (
                {money(selected.total_repayable)} total) ·{" "}
                {money(selected.instalment)} monthly recovery
              </span>
              <span>First recovery: {periodName(selected.first_recovery)}</span>
            </div>
            {mode === "disburse" && (
              <>
                <label>
                  Payment date
                  <input
                    type="date"
                    required
                    max={today()}
                    {...field("disbursed_on")}
                  />
                </label>
                <label>
                  Payment reference
                  <input
                    required
                    maxLength={150}
                    {...field("payment_reference")}
                  />
                </label>
                <p className="loan-note">
                  Record a payment already made to the employee.
                </p>
              </>
            )}
            <label>
              {["reject", "pause", "resume"].includes(mode)
                ? "Decision reason"
                : "Note (optional)"}
              <textarea
                rows={3}
                maxLength={2000}
                required={["reject", "pause", "resume"].includes(mode)}
                {...field("note")}
              />
            </label>
          </>
        </div>
        <div className="loan-dialog-actions">
          <button
            type="button"
            className="loan-button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="loan-button" disabled={busy}>
            {busy ? "Saving…" : actions[mode]}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default function Loans() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("loan");
  const [list, setList] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [success, setSuccess] = useState("");
  const [employeeId, setEmployeeId] = useState("all");
  const [status, setStatus] = useState("all");
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [mode, setMode] = useState(null);
  const [schedule, setSchedule] = useState(false);
  const [revision, setRevision] = useState(0);
  const registerHeading = useRef(null);
  const detailHeading = useRef(null);

  // Bring newly submitted employee requests into the admin queue while it is open.
  useEffect(() => {
    if (mode) return;
    const refresh = () => {
      if (document.visibilityState === "visible")
        setRevision((value) => value + 1);
    };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([api.get("/loans"), api.get("/employees")])
      .then(([loans, directory]) => {
        if (cancelled) return;
        setList(loans.data);
        setEmployees(directory.data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err.response?.data?.message ||
              "Unable to load loans. Please retry.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailLoading(false);
      setDetailError("");
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError("");
    setDetail(null);
    setSchedule(false);
    api
      .get(`/loans/${selectedId}`)
      .then(({ data }) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled)
          setDetailError(
            err.response?.data?.message || "Unable to load loan detail.",
          );
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, revision]);

  const outstanding = list.filter((loan) =>
    ["approved", "active", "paused"].includes(loan.status),
  );
  const recovery = list.reduce((sum, loan) => {
    const recorded = loan.period_recoveries.find(
      (entry) =>
        `${entry.year}-${String(entry.month).padStart(2, "0")}` === period,
    );
    if (recorded) return sum + Number(recorded.amount);
    return sum + scheduledLoanDeductions([loan], loan.employee_id, period)
      .reduce((total, entry) => total + entry.amount, 0);
  }, 0);
  const shown = useMemo(
    () =>
      list.filter(
        (loan) =>
          (status === "all" || loan.status === status) &&
          (employeeId === "all" || String(loan.employee_id) === employeeId),
      ),
    [list, status, employeeId],
  );
  useEffect(() => {
    if (loading || error || mode) return;
    if (!selectedId || !shown.some((loan) => String(loan.id) === selectedId)) {
      const nextId = shown.length ? String(shown[0].id) : null;
      if (nextId !== selectedId)
        setParams(nextId ? { loan: nextId } : {}, { replace: true });
    }
  }, [shown, selectedId, loading, error, mode, setParams]);
  function selectLoan(id) {
    if (String(id) !== selectedId) setParams({ loan: String(id) });
  }
  function showPending() {
    const pending = list.find((loan) => loan.status === "pending");
    setStatus("pending");
    setEmployeeId("all");
    setSuccess("");
    setParams(pending ? { loan: String(pending.id) } : {});
    const heading = pending ? detailHeading.current : registerHeading.current;
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start", behavior: "auto" });
  }
  const selected = detail;
  const remainingCents = Math.round(Number(selected?.outstanding || 0) * 100);
  const instalmentCents = Math.round(Number(selected?.instalment || 0) * 100);
  const remainingCount = instalmentCents
    ? Math.ceil(remainingCents / instalmentCents)
    : 0;
  const upcoming = [];
  if (selected && ["active", "paused", "approved"].includes(selected.status)) {
    const last = selected.recoveries.at(-1);
    const start = [
      selected.first_recovery.slice(0, 7),
      period,
      selected.disbursed_on?.slice(0, 7) || "",
    ]
      .sort()
      .at(-1);
    const next = new Date(`${start}-01T12:00:00`);
    if (last && new Date(last.year, last.month - 1, 1) >= next)
      next.setFullYear(last.year, last.month, 1);
    for (let i = 0; i < Math.min(remainingCount, 12); i++) {
      upcoming.push({
        period: next.toLocaleDateString("en-IN", {
          month: "short",
          year: "numeric",
        }),
        amount:
          Math.min(instalmentCents, remainingCents - i * instalmentCents) / 100,
      });
      next.setMonth(next.getMonth() + 1);
    }
  }
  function saved(id) {
    // Keep the reviewed request visible when a decision removes it from a status filter.
    setStatus("all");
    setMode(null);
    setSuccess("Loan saved successfully.");
    setParams({ loan: String(id) });
    setRevision((value) => value + 1);
  }

  return (
    <div className="loans-page">
      <div className="loan-page-head">
        <div>
          <h1>Salary loans</h1>
          <p>Manage requests, disbursement and recovery</p>
        </div>
        <div className="loan-head-actions">
          <button
            type="button"
            className="loan-button secondary"
            disabled={loading || !!mode}
            onClick={() => setRevision((value) => value + 1)}
          >
            <FiRefreshCw />
            Refresh
          </button>
        </div>
      </div>
      {error && (
        <p className="loan-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="loan-success" role="status">
          {success}
        </p>
      )}
      <div className="loan-summary">
        <div className="loan-stat">
          <div>
            <strong>Outstanding</strong>
            <FaRupeeSign />
          </div>
          <b>
            {loading || error
              ? "—"
              : money(
                  outstanding.reduce(
                    (sum, loan) => sum + Number(loan.outstanding),
                    0,
                  ),
                )}
          </b>
          <span>
            Across {new Set(outstanding.map((loan) => loan.employee_id)).size}{" "}
            employees
          </span>
        </div>
        <div className="loan-stat">
          <div>
            <strong>
              {period ? periodName(`${period}-01`) : "Monthly"} recovery
            </strong>
            <FiRepeat />
          </div>
          <b>{loading || error ? "—" : money(recovery)}</b>
          <span>Recorded or scheduled for the selected month</span>
        </div>
        <div className="loan-stat peach">
          <div>
            <strong>Pending requests</strong>
            <FiClock />
          </div>
          <b>
            {loading || error
              ? "—"
              : list.filter((loan) => loan.status === "pending").length}
          </b>
          <span>Waiting for approval or rejection</span>
          <button
            type="button"
            className="loan-review-pending"
            disabled={loading || !!error || !!mode}
            onClick={showPending}
          >
            Review pending requests
          </button>
        </div>
      </div>
      <div className="loan-workspace">
        <section
          className="loan-panel loan-register-panel"
          aria-labelledby="loan-register-title"
        >
          <div className="loan-panel-head">
            <div>
              <h2 id="loan-register-title" ref={registerHeading} tabIndex={-1}>
                Loan register
              </h2>
              <p className="loan-register-help">
                Select an employee or request to review and approve or reject
                it.
              </p>
            </div>
          </div>
          <div className="loan-filters loan-admin-filters">
            <EmployeeSearch
              employees={employees}
              value={employeeId}
              onChange={setEmployeeId}
              loading={loading}
            />
            <label>
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {[
                  "all",
                  "pending",
                  "approved",
                  "active",
                  "paused",
                  "completed",
                  "rejected",
                ].map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Recovery month
              <input
                type="month"
                value={period}
                onChange={(event) => {
                  if (event.target.value) setPeriod(event.target.value);
                }}
              />
            </label>
          </div>
          <div className="loan-table-wrap">
            <table className="loan-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Outstanding</th>
                  <th>Recovery</th>
                  <th>Status</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="loan-empty" role="status">
                      Loading loans…
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={5} className="loan-empty">
                      Loan register unavailable. Use Refresh to retry.
                    </td>
                  </tr>
                ) : !shown.length ? (
                  <tr>
                    <td colSpan={5} className="loan-empty">
                      {employeeId !== "all" &&
                      !list.some(
                        (loan) => String(loan.employee_id) === employeeId,
                      )
                        ? "This employee has not submitted a loan request."
                        : status === "pending" && employeeId === "all"
                          ? "No pending requests to review."
                          : list.length
                            ? "No loans match your filters."
                            : "No loan requests yet. Employee requests will appear here."}
                    </td>
                  </tr>
                ) : (
                  shown.map((loan) => (
                    <tr
                      key={loan.id}
                      onClick={(event) => {
                        if (!event.target.closest("button"))
                          selectLoan(loan.id);
                      }}
                      className={
                        String(loan.id) === selectedId ? "is-selected" : ""
                      }
                    >
                      <td data-label="Employee">
                        <button
                          type="button"
                          className="loan-employee"
                          aria-pressed={String(loan.id) === selectedId}
                          onClick={() => selectLoan(loan.id)}
                        >
                          <span className="loan-avatar" aria-hidden="true">
                            {loan.name
                              .split(/\s+/)
                              .slice(0, 2)
                              .map((part) => part[0])
                              .join("")}
                          </span>
                          <span>
                            <strong>{loan.name}</strong>
                            <small>{loan.emp_code}</small>
                            <small className="loan-reference">LOAN-{loan.id}</small>
                          </span>
                        </button>
                      </td>
                      <td data-label="Balance / amount">
                        {["pending", "approved", "rejected"].includes(
                          loan.status,
                        ) ? (
                          <>
                            <strong>{money(loan.amount)}</strong>
                            <small>
                              {loan.interest_percentage}% {loan.instalment_count ? '/ month' : 'one-time interest'}
                            </small>
                            <small>Total {money(loan.total_repayable)}</small>
                          </>
                        ) : (
                          <strong>{money(loan.outstanding)}</strong>
                        )}
                      </td>
                      <td data-label="Monthly recovery">
                        <strong>{money(loan.instalment)}</strong>
                        <small>per month</small>
                      </td>
                      <td data-label="Status">
                        <span className={`loan-badge ${loan.status}`}>
                          {label(loan.status)}
                        </span>
                      </td>
                      <td data-label="Review">
                        <button
                          type="button"
                          className="loan-button secondary"
                          aria-label={`Review ${loan.name} request LOAN-${loan.id}`}
                          onClick={() => selectLoan(loan.id)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="loan-register-footer">
            Showing {error ? 0 : shown.length} of {error ? 0 : list.length}{" "}
            loans
          </p>
        </section>
        <section
          className="loan-panel loan-detail"
          aria-labelledby="loan-detail-title"
        >
          <div className="loan-panel-head">
            <h2 id="loan-detail-title" ref={detailHeading} tabIndex={-1}>
              Loan detail
            </h2>
          </div>
          <div className="loan-detail-body">
            {detailLoading ? (
              <p role="status">Loading loan detail…</p>
            ) : detailError ? (
              <p role="alert" className="loan-error">
                {detailError}
              </p>
            ) : !selected ? (
              <div className="loan-empty">
                <FiInfo />
                <p>Select an employee in the register to review their loan.</p>
              </div>
            ) : (
              <>
                <div className="loan-detail-identity">
                  <div>
                    <h3>{selected.name}</h3>
                    <small>
                      {selected.emp_code} · LOAN-{selected.id}
                    </small>
                  </div>
                  <span className={`loan-badge ${selected.status}`}>
                    {label(selected.status)}
                  </span>
                </div>
                {selected.status === "pending" && (
                  <p className="loan-awaiting-review" role="status">
                    Waiting for your approval or rejection. No payment or
                    recovery starts while this request is pending.
                  </p>
                )}
                <div className="loan-detail-actions">
                  {(selected.status === "pending"
                    ? ["approve", "reject"]
                    : selected.status === "approved"
                      ? ["disburse"]
                      : selected.status === "active"
                        ? ["pause"]
                        : selected.status === "paused"
                          ? ["resume"]
                          : []
                  ).map((action) => (
                    <button
                      type="button"
                      className={`loan-button ${action === "reject" || action === "pause" ? "secondary" : ""}`}
                      key={action}
                      onClick={() => setMode(action)}
                    >
                      {actions[action]}
                    </button>
                  ))}
                </div>
                <dl className="loan-facts">
                  <div>
                    <dt>
                      {selected.status === "pending" ||
                      selected.status === "rejected"
                        ? "Requested loan"
                        : "Approved loan"}
                    </dt>
                    <dd>{money(selected.amount)}</dd>
                  </div>
                  {selected.instalment_count && (
                    <div>
                      <dt>
                        Interest per month ({selected.interest_percentage}%)
                      </dt>
                      <dd>
                        {money(selected.monthly_interest_amount)}
                        <small>On the original loan amount</small>
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>
                      Total interest ({selected.interest_percentage}%{" "}
                      {selected.instalment_count ? "per month" : "one-time"})
                    </dt>
                    <dd>{money(selected.interest_amount)}</dd>
                  </div>
                  <div>
                    <dt>Total repayment (all instalments)</dt>
                    <dd>
                      <LoanRepaymentTotal
                        total={selected.total_repayable}
                        instalment={selected.instalment}
                        count={selected.instalment_count}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Recovery plan</dt>
                    <dd>
                      {selected.instalment_count ??
                        Math.ceil(
                          Number(selected.total_repayable) /
                            Number(selected.instalment),
                        )}{" "}
                      instalments of {money(selected.instalment)}
                      <small>Final instalment adjusts to balance</small>
                    </dd>
                  </div>
                  <div>
                    <dt>First recovery</dt>
                    <dd>{periodName(selected.first_recovery)}</dd>
                  </div>
                  <div>
                    <dt>Paid to employee</dt>
                    <dd>{dateName(selected.disbursed_on)}</dd>
                  </div>
                  {selected.payment_reference && (
                    <div>
                      <dt>Payment reference</dt>
                      <dd>{selected.payment_reference}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Recovered in payroll</dt>
                    <dd>{money(selected.recovered)}</dd>
                  </div>
                  <div>
                    <dt>
                      Outstanding balance
                    </dt>
                    <dd>{money(selected.outstanding)}</dd>
                  </div>
                  <div>
                    <dt>Reason</dt>
                    <dd>{selected.reason}</dd>
                  </div>
                </dl>
                <div className="loan-callout">
                  <FiInfo />
                  <div>
                    <strong>Recovery appears in pay detail</strong>
                    <p>
                      Each recorded deduction links to this loan. Balances
                      update when payslips are generated.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="loan-schedule-button"
                  aria-expanded={schedule}
                  onClick={() => setSchedule(!schedule)}
                >
                  {schedule
                    ? "Hide recovery schedule"
                    : "View recovery schedule"}
                </button>
                {schedule && (
                  <div className="loan-schedule">
                    <h3>Recorded payroll recoveries</h3>
                    {!selected.recoveries.length ? (
                      <p>No recoveries recorded yet.</p>
                    ) : (
                      selected.recoveries.map((entry) => (
                        <div key={entry.payslip_id}>
                          <Link
                            to={`/admin/payroll?payslip=${entry.payslip_id}`}
                          >
                            {periodName(
                              `${entry.year}-${String(entry.month).padStart(2, "0")}-01`,
                            )}{" "}
                            · Payslip #{entry.payslip_id}
                          </Link>
                          <strong>{money(entry.amount)}</strong>
                        </div>
                      ))
                    )}
                    {upcoming.length > 0 && (
                      <>
                        <h3>Upcoming instalments</h3>
                        <p>
                          {selected.status === "paused"
                            ? "Recovery is paused. Resume to include future instalments."
                            : selected.status === "approved"
                              ? "Payroll deductions start in the first recovery month after approval."
                              : "Projection assumes one payroll per month. Actual recoveries depend on generated payslips."}
                        </p>
                        {upcoming.map((entry) => (
                          <div key={entry.period}>
                            <span>{entry.period}</span>
                            <strong>{money(entry.amount)}</strong>
                          </div>
                        ))}
                        {remainingCount > 12 && (
                          <p>
                            Showing the next 12 of {remainingCount} remaining
                            instalments.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
                <details className="loan-history" open>
                  <summary>Approval and activity history</summary>
                  {selected.events.map((event, index) => (
                    <div
                      key={index}
                      className={
                        event.action === "reject" ? "loan-rejection-event" : ""
                      }
                    >
                      <strong>
                        {eventNames[event.action] || event.action}
                      </strong>
                      <small>
                        {event.actor || "Former user"} ·{" "}
                        {new Date(event.created_at).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })}
                      </small>
                      {event.note && (
                        <p>
                          {event.action === "reject" && (
                            <strong>Rejection reason: </strong>
                          )}
                          {event.note}
                        </p>
                      )}
                    </div>
                  ))}
                </details>
              </>
            )}
          </div>
        </section>
      </div>
      {mode && (
        <LoanDialog
          mode={mode}
          selected={selected}
          onClose={() => setMode(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}
