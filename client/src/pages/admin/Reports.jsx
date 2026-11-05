import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  FiArrowLeft,
  FiArrowRight,
  FiDownload,
  FiFileText,
  FiRefreshCw,
  FiPrinter,
  FiSearch,
  FiDollarSign,
  FiClock,
  FiCalendar,
  FiUsers,
  FiCreditCard,
  FiTrendingUp,
  FiShield,
} from "react-icons/fi";
import api from "../../api";
import ReportCategoryDashboard from "../../components/ReportCategoryDashboard";
import {
  buildReports,
  formatReportValue,
  reportCategories,
  reportCsv,
} from "../../utils/reportData";

const PAGE_SIZE = 25;
const format = formatReportValue;
const categoryInfo = {
  payroll: {
    Icon: FiDollarSign,
    description: "Salary breakdowns, monthly totals and changes.",
  },
  attendance: {
    Icon: FiClock,
    description: "Days present, unpaid leave and hours worked.",
  },
  leave: {
    Icon: FiCalendar,
    description: "Leave requests, paid days used and remaining balance.",
  },
  deductions: {
    Icon: FiDollarSign,
    description: "PF, professional tax, loans and other salary deductions.",
  },
  employees: {
    Icon: FiUsers,
    description: "Employee lists, new joiners and exits.",
  },
  payments: {
    Icon: FiCreditCard,
    description: "Salary payments and bank transactions.",
  },
  payslips: {
    Icon: FiFileText,
    description: "See whose payslip is generated or still pending.",
  },
  loans: {
    Icon: FiCreditCard,
    description: "Loan amounts, repayments and outstanding balances.",
  },
  analytics: {
    Icon: FiTrendingUp,
    description: "Average salaries, department costs and headcount changes.",
  },
  audit: {
    Icon: FiShield,
    description: "Recorded changes and the people who made them.",
  },
};
const descriptions = {
  register: "See each employee’s salary and take-home pay.",
  "monthly-payroll":
    "See the total salary, deductions and take-home pay for the month.",
  "department-payroll": "Compare salary totals across departments.",
  salary: "See basic salary, each allowance and total deductions.",
  variance: "Compare this month’s salary with the previous month.",
  "attendance-summary":
    "See total present days, leave days and recorded hours.",
  "employee-attendance": "See attendance totals for each employee.",
  "department-attendance": "Compare attendance across departments.",
  "present-unpaid": "See daily records marked present or unpaid leave.",
  "worked-hours": "See hours calculated from check-in and check-out times.",
  "missing-punch": "Find days with a missing check-in or check-out.",
  utilization: "Compare requested, approved, rejected and pending leave days.",
  balance: "See the two-day monthly allowance and remaining paid days.",
  "department-leave": "Compare leave requests across departments.",
  "type-leave": "See leave days by casual, sick and paid leave type.",
  "approved-leave": "See approved requests and their dates.",
  "rejected-leave": "See rejected requests and their dates.",
  "pending-leave": "See leave requests waiting for approval.",
  "deduction-summary": "See all salary deductions for each employee.",
  pf: "See employee PF amounts deducted from salary.",
  pt: "See professional tax deducted from salary.",
  "loan-deductions": "See loan repayments deducted from this month’s salary.",
  "advance-deductions": "See salary advance repayments for the month.",
  "other-deductions": "See additional deductions, including unpaid leave.",
  "employee-summary": "See employee counts, new joiners and exits.",
  "employee-register": "See employee details and employment dates.",
  "department-staff": "See employee counts by department and designation.",
  joiners: "See employees who joined this month.",
  exits: "See employees who left this month.",
  "payslip-summary": "See how many payslips are generated or not generated.",
  "payslip-register": "Check the payslip status of each employee.",
  "loan-register": "See each loan, repayments and the amount still owed.",
  "loan-summary":
    "See issued amounts, monthly repayments and outstanding loans.",
  "payroll-analytics": "See monthly salary totals and average salary.",
  headcount: "See how new joiners and exits change the employee count.",
  "department-cost": "Compare department salary totals and averages.",
  "loan-audit": "See recorded loan actions, dates and who made them.",
};
const readableLabel = (c) =>
  ({
    gross: "Salary before deductions",
    net: "Take-home pay",
    total_deductions: "Total deductions",
  })[c.key] || c.label;

function ReportMetrics({ report }) {
  if (!report?.summary || !report.rows.length) return null;
  const columns = report.columns
    .filter((c) => ["money", "number", "percent"].includes(c.type))
    .slice(0, 4);
  if (!columns.length) return null;
  return (
    <span className="report-detail-metrics">
      {columns.map((c) => (
        <span key={c.key}>
          <span className="report-metric-label">{readableLabel(c)}</span>
          <strong>{format(report.summary[c.key], c.type)}</strong>
        </span>
      ))}
    </span>
  );
}

export default function Reports() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [defaultPeriod] = useState(() => {
    const requested = params.get('period');
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(requested || '') && Number(requested.slice(0, 4)) >= 2000 && Number(requested.slice(0, 4)) <= 2100) return requested;
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
  });
  const requestedPeriod = params.get('period');
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedPeriod || '') && Number(requestedPeriod.slice(0, 4)) >= 2000 && Number(requestedPeriod.slice(0, 4)) <= 2100 ? requestedPeriod : defaultPeriod;
  const [department, setDepartment] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const category = reportCategories.some(([id]) => id === params.get('category')) ? params.get('category') : '';
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: "", ascending: true });
  function setCategory(id) {
    const next = new URLSearchParams(params);
    next.set('period', period);
    if (id) next.set('category', id);
    else next.delete('category');
    setParams(next);
  }
  useEffect(() => {
    setSelected('');
    setSearch('');
    setSort({ key: '', ascending: true });
  }, [category]);
  const detailHeading = useRef(null);
  const [year, month] = period.split("-").map(Number);
  const periodLabel = new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api
      .get("/reports", { params: { period }, signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setData(response.data);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(
            err?.response?.data?.message ||
              "Unable to load reports. Please try again.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [period, reload]);

  const reports = useMemo(
    () => buildReports(data || {}, { period, department, employeeId }),
    [data, period, department, employeeId],
  );
  const report = reports.find((r) => r.id === selected && r.category === category);
  const visibleReports = reports.filter(
    (r) =>
      r.category === category &&
      `${r.title} ${r.note}`.toLowerCase().includes(search.toLowerCase()),
  );
  const availableReports = visibleReports.filter((r) => !r.unavailable);
  const unavailableReports = visibleReports.filter((r) => r.unavailable);
  const payrollTotals = reports.find(
    (r) => r.id === "monthly-payroll",
  )?.summary;
  const departments = [
    ...new Set((data?.employees || []).map((e) => e.department)),
  ].sort();
  const employees = (data?.employees || []).filter(
    (e) => !department || e.department === department,
  );
  const employeeLabel =
    employees.find((e) => String(e.id) === employeeId)?.name || "All employees";
  const categoryLabel = reportCategories.find(([id]) => id === category)?.[1];
  const canExport =
    !loading &&
    !error &&
    report &&
    !report.unavailable &&
    report.rows.length > 0;
  const generatedAt = data?.generated_at
    ? new Date(data.generated_at).toLocaleString("en-IN")
    : "";
  const sortedRows = useMemo(() => {
    const rows = [...(report?.rows || [])];
    if (sort.key) {
      const type = report.columns.find((c) => c.key === sort.key)?.type;
      rows.sort((a, b) => {
        const value = ["money", "number", "percent"].includes(type)
          ? (Number(a[sort.key]) || 0) - (Number(b[sort.key]) || 0)
          : String(a[sort.key] ?? "").localeCompare(
              String(b[sort.key] ?? ""),
              "en",
              { numeric: true },
            );
        return sort.ascending ? value : -value;
      });
    }
    return rows;
  }, [report, sort]);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = sortedRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  useEffect(() => {
    setPage(1);
  }, [selected, period, department, employeeId]);

  function openReport(id) {
    setSelected(id);
    setPage(1);
    setSort({ key: "", ascending: true });
    requestAnimationFrame(() => detailHeading.current?.focus());
  }
  function exportCsv() {
    if (!canExport) return;
    const content = reportCsv(report, {
      Company: "5 Gen Educon Private Limited",
      Period: periodLabel,
      Department: department || "All departments",
      Employee: employeeLabel,
      Generated: generatedAt,
    });
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8;" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${report.id}-${period}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderTable(rows, className = "") {
    return (
      <div className={`reports-table-scroll ${className}`}>
        <table>
          <caption className="reports-sr-only">
            {report.title} — {periodLabel}
          </caption>
          <thead>
            <tr>
              {report.columns.map((c) => (
                <th
                  scope="col"
                  key={c.key}
                  aria-sort={
                    sort.key === c.key
                      ? sort.ascending
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    className="report-sort"
                    onClick={() =>
                      setSort((s) => ({
                        key: c.key,
                        ascending: s.key === c.key ? !s.ascending : true,
                      }))
                    }
                  >
                    {readableLabel(c)}
                    {sort.key === c.key ? (sort.ascending ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.id ?? row.employee_id ?? row.department ?? "row"}-${index}`}
              >
                {report.columns.map((c) => (
                  <td
                    key={c.key}
                    className={
                      ["money", "number", "percent"].includes(c.type)
                        ? "report-numeric"
                        : ""
                    }
                  >
                    {c.key === "name" && (row.employee_id || ['employees', 'payslips'].includes(report.category)) ? (
                      <Link to={`/admin/reports/employees/${row.employee_id ?? row.id}?period=${period}`}>
                        {format(row[c.key], c.type)}
                      </Link>
                    ) : (
                      format(row[c.key], c.type)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {report.rows.length > 1 &&
            report.columns.some((c) => c.type === "money") && (
              <tfoot>
                <tr>
                  {report.columns.map((c, index) => (
                    <td key={c.key}>
                      {index === 0
                        ? "Total"
                        : c.type === "money" && c.key !== "average"
                          ? format(
                              report.rows.reduce(
                                (sum, r) => sum + (Number(r[c.key]) || 0),
                                0,
                              ),
                              "money",
                            )
                          : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
        </table>
      </div>
    );
  }

  return (
    <div className="reports-page">
      <div className="reports-heading">
        <div>
          <h1>Reports</h1>
          <p>Choose a month, then open the report you need.</p>
        </div>
        <div className="reports-actions">
          <Link className="reports-primary" to={`/admin/reports/employees?period=${period}`}>
            <FiUsers /> Employee reports
          </Link>
          <button
            type="button"
            className="reports-secondary"
            disabled={loading}
            onClick={() => setReload((r) => r + 1)}
          >
            <FiRefreshCw />
            Refresh
          </button>
          {report && !report.unavailable && (
            <>
              <button
                type="button"
                className="reports-secondary"
                disabled={!canExport}
                onClick={exportCsv}
              >
                <FiDownload />
                Download CSV
              </button>
              <button
                type="button"
                className="reports-primary"
                disabled={!canExport}
                onClick={() => window.print()}
              >
                <FiPrinter />
                Print / Save PDF
              </button>
            </>
          )}
        </div>
      </div>
      <div className="reports-filters">
        <label>
          Report month
          <input
            type="month"
            min="2000-01"
            max="2100-12"
            value={period}
            onChange={(e) => {
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) {
                const next = new URLSearchParams(params);
                next.set('period', e.target.value);
                setParams(next);
              }
            }}
          />
        </label>
        <label>
          Department
          <select
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setEmployeeId("");
            }}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Employee
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.emp_code})
              </option>
            ))}
          </select>
        </label>
        {(department || employeeId) && (
          <button
            type="button"
            className="reports-secondary"
            onClick={() => {
              setDepartment("");
              setEmployeeId("");
            }}
          >
            Clear filters
          </button>
        )}
        {employeeId && <Link className="reports-primary" to={`/admin/reports/employees/${employeeId}?period=${period}`}>View individual report</Link>}
      </div>
      <div className="report-workspace">
        <div className="report-workspace-content">
          {category && !selected && <button type="button" className="reports-secondary report-back" onClick={() => { setCategory(""); setSearch(""); }}><FiArrowLeft />Back to report categories</button>}
          {loading ? (
            <p className="reports-state" role="status">
              Loading reports…
            </p>
          ) : error ? (
            <div className="reports-state" role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="reports-primary"
                onClick={() => setReload((r) => r + 1)}
              >
                Try again
              </button>
            </div>
          ) : !category ? (
            <ReportCategoryDashboard
              categories={reportCategories.map(([id, label]) => {
                const categoryReports = reports.filter((r) => r.category === id);
                const available = categoryReports.filter((r) => !r.unavailable).length;
                return { id, label, ...categoryInfo[id], summary: available ? `${available} report${available === 1 ? '' : 's'} available` : 'Reports awaiting data' };
              })}
              onOpen={(id) => { if (id === 'employees') { navigate(`/admin/reports/employees?period=${period}`); return; } setCategory(id); setSelected(""); setSearch(""); }}
            />
          ) : report ? (
            <>
              <button
                className="reports-secondary report-back"
                type="button"
                onClick={() => setSelected("")}
              >
                <FiArrowLeft />
                Back to {categoryLabel} reports
              </button>
              <section className="reports-table-card">
                <div className="reports-table-heading">
                  <h2 ref={detailHeading} tabIndex={-1}>
                    {report.title}
                  </h2>
                  <p>
                    {periodLabel} · {department || "All departments"} ·{" "}
                    {employeeLabel} · {report.rows.length} records
                  </p>
                </div>
                {report.unavailable ? (
                  <div className="reports-state">
                    <FiFileText size={32} />
                    <h3>Data not tracked yet</h3>
                    <p>{report.note}</p>
                  </div>
                ) : report.rows.length === 0 ? (
                  <div className="reports-state">
                    <FiFileText size={32} />
                    <h3>No records for this selection</h3>
                    <p>
                      Choose another month or adjust the department and employee
                      filters.
                    </p>
                    {[
                      "payroll",
                      "deductions",
                      "payslips",
                      "analytics",
                    ].includes(category) && (
                      <Link to="/admin/payroll">Open Payroll</Link>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="report-detail-overview">
                      <p>
                        {descriptions[report.id] ||
                          categoryInfo[category].description}
                      </p>
                      <span className="report-preview-context">
                        {report.summary?.name ||
                          report.summary?.department ||
                          "Monthly summary"}
                        {report.rows.length > 1 &&
                          " · Preview of the first record"}
                      </span>
                      <ReportMetrics report={report} />
                    </div>
                    {renderTable(pageRows, "report-screen-table")}
                    {renderTable(sortedRows, "report-print-table")}
                    <div className="report-pagination">
                      <span>
                        Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                        {Math.min(currentPage * PAGE_SIZE, sortedRows.length)}{" "}
                        of {sortedRows.length}
                      </span>
                      <button
                        type="button"
                        className="reports-secondary"
                        disabled={currentPage === 1}
                        onClick={() => setPage(currentPage - 1)}
                      >
                        Previous
                      </button>
                      <span>
                        Page {currentPage} of {pageCount}
                      </span>
                      <button
                        type="button"
                        className="reports-secondary"
                        disabled={currentPage === pageCount}
                        onClick={() => setPage(currentPage + 1)}
                      >
                        Next
                      </button>
                    </div>
                  </>
                )}
                {report.note && (
                  <details className="report-explanation">
                    <summary>How to read this report</summary>
                    <p>{report.note}</p>
                    {["payroll", "deductions", "analytics"].includes(
                      category,
                    ) && (
                      <p>
                        <strong>Salary before deductions (gross)</strong> is
                        basic salary plus all allowances.{" "}
                        <strong>Take-home pay (net)</strong> is the amount left
                        after deductions.
                      </p>
                    )}
                  </details>
                )}
                <p className="report-print-note">{report.note}</p>
                <p className="reports-source-note">
                  5 Gen Educon Private Limited · Updated {generatedAt}
                </p>
              </section>
            </>
          ) : (
            <>
              <div className="report-catalog-heading">
                <div>
                  <h2>{categoryLabel}</h2>
                  <p>{categoryInfo[category].description}</p>
                </div>
                <label className="report-search">
                  <FiSearch />
                  <span className="reports-sr-only">
                    Find a report in this category
                  </span>
                  <input
                    type="search"
                    value={search}
                    placeholder="Find a report"
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              <p className="report-selection-label">
                {periodLabel} · {department || "All departments"} ·{" "}
                {employeeLabel}
              </p>
              {category === "payroll" && payrollTotals && (
                <>
                  <p className="report-payroll-caption">
                    Saved payslips for {payrollTotals.employees}{" "}
                    {payrollTotals.employees === 1 ? "employee" : "employees"}
                  </p>
                  <div className="report-payroll-overview">
                    {[
                      [
                        "Salary before deductions",
                        payrollTotals.gross,
                        "Basic salary + all allowances",
                      ],
                      [
                        "Total deductions",
                        payrollTotals.total_deductions,
                        "Amounts taken from salary",
                      ],
                      [
                        "Take-home pay",
                        payrollTotals.net,
                        "Salary after deductions",
                      ],
                    ].map(([label, value, hint]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <strong>{format(value, "money")}</strong>
                        <small>{hint}</small>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {!!availableReports.length && (
                <div className="report-list">
                  <div className="report-list-heading">
                    <h3>Choose a report</h3>
                    <span>{availableReports.length} available</span>
                  </div>
                  {availableReports.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      className="report-list-row"
                      onClick={() => openReport(r.id)}
                    >
                      <span className="report-row-icon">
                        <FiFileText />
                      </span>
                      <span className="report-row-text">
                        <strong>{r.title}</strong>
                        <span>
                          {descriptions[r.id] ||
                            categoryInfo[category].description}
                        </span>
                        <small>
                          {r.rows.length
                            ? `${r.rows.length} ${r.rows.length === 1 ? "record" : "records"}`
                            : "No records for these filters"}
                        </small>
                      </span>
                      <span className="report-row-open">
                        View
                        <FiArrowRight />
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {!!unavailableReports.length && (
                <details
                  className="report-unavailable-list"
                  open={availableReports.length === 0}
                >
                  <summary>
                    Reports needing more data ({unavailableReports.length})
                  </summary>
                  <p>
                    These reports will be available when the required
                    information is recorded.
                  </p>
                  {unavailableReports.map((r) => (
                    <div key={r.id}>
                      <strong>{r.title}</strong>
                      <p>{r.note}</p>
                    </div>
                  ))}
                </details>
              )}
              {!visibleReports.length && (
                <p className="reports-state">No reports match your search.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
