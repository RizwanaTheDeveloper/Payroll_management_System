import { Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import FirstSignIn from './pages/FirstSignIn';
const AdvancesPage = lazy(() => import('./components/AdvancesPage'));

import Login from './pages/Login';

const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const Employees = lazy(() => import('./pages/admin/Employees'));
const AdminPayroll = lazy(() => import('./pages/admin/Payroll'));
const AdminLeaves = lazy(() => import('./pages/admin/Leaves'));
const AdminAttendance = lazy(() => import('./pages/admin/Attendance'));
const Loans = lazy(() => import('./pages/admin/Loans'));
const Reports = lazy(() => import('./pages/admin/Reports'));
const EmployeeReports = lazy(() => import('./pages/admin/EmployeeReports'));
const Settings = lazy(() => import('./pages/admin/Settings'));

const EmpDashboard = lazy(() => import('./pages/employee/Dashboard'));
const Payslips = lazy(() => import('./pages/employee/Payslips'));
const Attendance = lazy(() => import('./pages/employee/Attendance'));
const Leaves = lazy(() => import('./pages/employee/Leaves'));
const TeamLeaves = lazy(() => import('./pages/admin/Leaves'));
const TeamAttendance = lazy(() => import('./pages/admin/Attendance'));
const TeamDashboard = lazy(() => import('./pages/manager/TeamDashboard'));
const TeamRequests = lazy(() => import('./pages/manager/TeamRequests'));
const TeamReport = lazy(() => import('./pages/manager/TeamReport'));
const TeamPayroll = lazy(() => import('./pages/manager/TeamPayroll'));
const TeamAttendanceRequests = lazy(() => import('./pages/manager/TeamAttendanceRequests'));
const Approvals = lazy(() => import('./pages/admin/Approvals'));
const EmployeeLoans = lazy(() => import('./pages/employee/Loans'));

/* React Icons */
import {
  FiHome,
  FiUsers,
  FiClipboard,
  FiClock,
  FiCalendar,
  FiEdit3,
  FiFileText,
  FiSettings
} from 'react-icons/fi';
import { FaHandHoldingUsd, FaRupeeSign } from 'react-icons/fa';


/* ---------------------------------------
   Admin Navigation
--------------------------------------- */

const adminLinks = [
  ['/admin', 'Overview', <FiHome />, 'Workspace'],
  ['/admin/approvals', 'Approvals', <FiClipboard />, 'Workspace'],
  ['/admin/employees', 'Employees', <FiUsers />, 'People'],
  ['/admin/attendance', 'Attendance', <FiClock />, 'People'],
  ['/admin/leaves', 'Leave', <FiCalendar />, 'People'],
  ['/admin/payroll', 'Payroll', <FiClipboard />, 'Money'],
  ['/admin/loans', 'Loans', <FaHandHoldingUsd />, 'Money'],
  ['/admin/advances', 'Advances', <FaRupeeSign />, 'Money'],
  ['/admin/reports', 'Reports', <FiFileText />, 'Reports & setup'],
  ['/admin/settings', 'Settings', <FiSettings />, 'Reports & setup'],
];


/* ---------------------------------------
   Employee Navigation
--------------------------------------- */

// Managers use the employee portal plus a team approvals page.
const managerLinks = [
  ['/employee/team', 'My team', <FiUsers />, 'Team', true],
  ['/employee/team-attendance', 'Team attendance', <FiClock />, 'Team'],
  ['/employee/team-attendance-requests', 'Corrections', <FiEdit3 />, 'Team', true],
  ['/employee/team-leaves', 'Team leave', <FiCalendar />, 'Team', true],
  ['/employee/team-requests', 'Team loans', <FaHandHoldingUsd />, 'Team'],
  ['/employee/team-payroll', 'Team payroll', <FaRupeeSign />, 'Team', true],
  ['/employee/team-report', 'Team report', <FiClipboard />, 'Team'],
  ['/employee', 'My home', <FiHome />, 'My work'],
  ['/employee/attendance', 'My attendance', <FiClock />, 'My work'],
  ['/employee/leaves', 'My leave', <FiCalendar />, 'My work'],
  ['/employee/payslips', 'My pay', <FiFileText />, 'My work'],
  ['/employee/loans', 'Loans', <FaHandHoldingUsd />, 'My work'],
  ['/employee/advances', 'Advances', <FaRupeeSign />, 'My work'],
  ['/employee/reports', 'Reports', <FiClipboard />, 'My work'],
  ['/employee/settings', 'Settings', <FiSettings />, 'My work'],
];

const empLinks = [
  ['/employee', 'Home', <FiHome />, null, true],
  ['/employee/attendance', 'Attendance', <FiClock />, null, true],
  ['/employee/leaves', 'Leave', <FiCalendar />, null, true],
  ['/employee/payslips', 'My pay', <FiFileText />, null, true],
  ['/employee/loans', 'Loans', <FaHandHoldingUsd />],
  ['/employee/advances', 'Advances', <FaRupeeSign />],
  ['/employee/reports', 'Reports', <FiClipboard />],
  ['/employee/settings', 'Settings', <FiSettings />],
];


export default function App() {
  const { user, loading } = useAuth();

  useEffect(() => {
    // Blur before the native wheel action so number values stay unchanged
    // and the wheel continues scrolling the page or dialog normally.
    const preventNumberWheelChange = (event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'number'
        && document.activeElement === event.target) {
        event.target.blur();
      }
    };
    document.addEventListener('wheel', preventNumberWheelChange, { capture: true, passive: true });
    return () => document.removeEventListener('wheel', preventNumberWheelChange, { capture: true });
  }, []);

  if (loading) return <main style={{ padding: 24 }} role="status">Loading…</main>;

  // Accounts issued with a temporary password must replace it before using the app.
  if (user?.must_change_password) return <FirstSignIn />;

  const home = user
    ? (user.role === 'admin' ? '/admin' : user.role === 'manager' ? '/employee/team' : '/employee')
    : '/login';

  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
    <Routes>

      {/* Login */}
      <Route
        path="/login"
        element={
          user
            ? <Navigate to={home} replace />
            : <Login />
        }
      />


      {/* Root */}
      <Route
        path="/"
        element={
          <Navigate
            to={home}
            replace
          />
        }
      />


      {/* ---------------------------------------
          ADMIN ROUTES
      --------------------------------------- */}

      <Route
        path="/admin"
        element={
          <ProtectedRoute role="admin">
            <Layout links={adminLinks} />
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={<AdminDashboard />}
        />

        <Route
          path="employees"
          element={<Employees />}
        />

        <Route
          path="payroll"
          element={<AdminPayroll />}
        />

        <Route
          path="attendance"
          element={<AdminAttendance />}
        />

        <Route
          path="leaves"
          element={<AdminLeaves />}
        />
        <Route path="loans" element={<Loans />} />
        <Route path="reports" element={<Reports />} />
        <Route path="reports/employees" element={<EmployeeReports />} />
        <Route path="reports/employees/:employeeId" element={<EmployeeReports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="advances" element={<AdvancesPage admin />} />
      </Route>


      {/* ---------------------------------------
          EMPLOYEE ROUTES
      --------------------------------------- */}

      <Route
        path="/employee"
        element={
          <ProtectedRoute role={['employee', 'manager']}>
            <Layout links={user?.role === 'manager' ? managerLinks : empLinks} />
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={<EmpDashboard />}
        />

        <Route
          path="payslips"
          element={<Payslips />}
        />

        <Route
          path="attendance"
          element={<Attendance />}
        />

        <Route
          path="leaves"
          element={<Leaves />}
        />
        <Route path="loans" element={<EmployeeLoans />} />
        <Route path="advances" element={<AdvancesPage />} />
        <Route path="reports" element={<EmployeeReports self />} />
        <Route path="settings" element={<Settings />} />
        {user?.role === 'manager' && <>
          <Route path="team" element={<TeamDashboard />} />
          <Route path="team-attendance" element={<TeamAttendance />} />
          <Route path="team-leaves" element={<TeamLeaves team />} />
          <Route path="team-requests" element={<TeamRequests />} />
          <Route path="team-report" element={<TeamReport />} />
          <Route path="team-payroll" element={<TeamPayroll />} />
          <Route path="team-attendance-requests" element={<TeamAttendanceRequests />} />
        </>}
      </Route>


      {/* ---------------------------------------
          FALLBACK
      --------------------------------------- */}

      <Route
        path="*"
        element={
          <Navigate
            to={home}
            replace
          />
        }
      />

    </Routes>
    </Suspense>
  );
}
