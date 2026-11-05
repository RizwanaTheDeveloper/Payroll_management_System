import { Fragment, Suspense, isValidElement, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { FiChevronsLeft, FiChevronsRight, FiGrid, FiHome, FiLogOut, FiMenu, FiX } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import ReportsNavigation from './ReportsNavigation';
import useNotifications from '../hooks/useNotifications';

// Which live count each menu entry shows (counts come from GET /api/notifications).
const BADGES = {
  '/admin/approvals': ['attendance_requests_pending'],
  '/admin/leaves': ['leave_pending'],
  '/admin/loans': ['loans_pending'],
  '/admin/advances': ['advances_pending'],
  '/admin/payroll': ['payroll_awaiting_approval', 'payroll_to_publish'],
  '/employee/team-attendance-requests': ['attendance_requests_pending'],
  '/employee/team-leaves': ['leave_pending'],
  '/employee/team-requests': ['credit_pending'],
  '/employee/team-payroll': ['payroll_drafts', 'payroll_to_publish'],
};

function NavIcon({ icon }) {
  if (isValidElement(icon)) return icon;
  if (typeof icon === 'function') { const Icon = icon; return <Icon />; }
  return <FiHome />;
}

export default function Layout({ links = [] }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => setCollapsed((value) => {
    const next = !value;
    try { localStorage.setItem('sidebar-collapsed', next ? '1' : '0'); } catch { /* storage unavailable */ }
    return next;
  });
  const menuButton = useRef(null);
  const sidebar = useRef(null);
  const isEmployee = user?.role === 'employee' || user?.role === 'manager';
  const counts = useNotifications();
  const badgeFor = (to) => (BADGES[to] || []).reduce((sum, key) => sum + (counts[key] || 0), 0);
  const badge = (to) => { const n = badgeFor(to); return n > 0 ? <span className="design-nav-badge" aria-label={`${n} waiting`}>{n}</span> : null; };
  const isReports = pathname === '/admin/reports' || pathname.startsWith('/admin/reports/');
  const userName = user?.name || 'User';
  const initials = userName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const pageTitle = (links.find(([to]) => to === pathname)
    || [...links].reverse().find(([to]) => pathname.startsWith(`${to}/`)))?.[1] || 'Payroll';

  // A link is matched exactly when other links live beneath it (/admin, /employee), so parents are not highlighted for every child page.
  const isExact = (to) => links.some(([other]) => other.startsWith(`${to}/`));
  const bottomLinks = links.length > 5 ? links.filter((link) => link[4]) : links;
  const hasMore = bottomLinks.length < links.length;

  useEffect(() => { document.title = `${pageTitle} · 5 Gen Payroll`; }, [pageTitle]);

  function closeMenu() { setOpen(false); menuButton.current?.focus(); }
  function signOut() { logout(); navigate('/login', { replace: true }); }

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 901px)');
    const onResize = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener('change', onResize);
    return () => desktop.removeEventListener('change', onResize);
  }, []);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector('button')?.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
      if (event.key === 'Tab') {
        const controls = [...sidebar.current.querySelectorAll('a, button')].filter((element) => element.getClientRects().length);
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKeyDown); };
  }, [open]);

  return (
    <div className={`design-app ${collapsed ? 'is-collapsed' : ''} ${isEmployee ? 'design-employee-app' : ''} ${isReports ? 'design-reports-app' : ''}`}>
      <a className="design-skip-link" href="#workspace-content">Skip to content</a>
      {open && <button className="design-sidebar-overlay" aria-label="Close navigation" onClick={closeMenu} />}
      <aside id="workspace-navigation" ref={sidebar} className={`design-sidebar ${open ? 'is-open' : ''}`} aria-label="Workspace navigation">
        <div className="design-sidebar-brand"><div className="design-company"><span className="design-logo" aria-hidden="true">5G</span><div><strong>5 Gen Payroll</strong><span>5 Gen Educon</span></div></div><button className="design-close-menu" type="button" aria-label="Close menu" onClick={closeMenu}><FiX /></button></div>
        <nav className={`design-navigation ${links.length > 9 ? 'is-dense' : ''}`} aria-label="Main menu">{links.map(([to, label, icon, group], index) => <Fragment key={to}>{group && group !== links[index - 1]?.[3] && <p className="design-nav-group">{group}</p>}<NavLink to={to} end={isExact(to)} title={collapsed ? label : undefined} className={({ isActive }) => `design-nav-link ${isActive ? 'is-active' : ''}`}><span className="design-nav-icon" aria-hidden="true"><NavIcon icon={icon} /></span><span className="design-nav-label">{label}</span>{badge(to)}</NavLink></Fragment>)}</nav>
        <div className="design-sidebar-bottom"><button className="design-collapse-btn" type="button" aria-pressed={collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleCollapsed}>{collapsed ? <FiChevronsRight aria-hidden="true" /> : <FiChevronsLeft aria-hidden="true" />}<span className="design-collapse-label">{collapsed ? 'Expand' : 'Collapse'}</span></button><div className="design-user"><span className="design-user-avatar" aria-hidden="true">{initials}</span><div><strong>{userName}</strong><span>{user?.role === 'manager' ? 'Manager' : isEmployee ? 'Employee' : 'Administrator'}</span></div><button className="design-logout" type="button" title="Sign out" aria-label="Sign out" onClick={signOut}><FiLogOut aria-hidden="true" /></button></div></div>
      </aside>
      <div className="design-app-main">
        <header className="design-topbar"><div className="design-topbar-left"><button ref={menuButton} className="design-open-menu" type="button" aria-label="Open navigation" aria-expanded={open} aria-controls="workspace-navigation" onClick={() => setOpen(!open)}><FiMenu /></button><span className="design-topbar-title">{pageTitle}</span></div><div className="design-topbar-right"><span className="design-topbar-workspace">{isEmployee ? 'My workspace' : 'Payroll workspace'}</span><span className="design-user-avatar" aria-label={userName}>{initials}</span></div></header>
        {isReports && <ReportsNavigation />}
        <main id="workspace-content" className="design-content" tabIndex={-1}><Suspense fallback={<div className="design-page-loading" role="status" aria-label="Loading page"><span /><span /><span /></div>}><Outlet /></Suspense></main>
        {isEmployee && <nav className="design-bottom-navigation" aria-label="Employee shortcuts">{bottomLinks.map(([to, label, icon]) => <NavLink key={to} to={to} end={isExact(to)} className={({ isActive }) => isActive ? 'is-active' : ''}><span aria-hidden="true"><NavIcon icon={icon} /></span><span>{label}</span>{badge(to)}</NavLink>)}{hasMore && <button type="button" className="design-bottom-more" aria-label="More menu items" onClick={() => setOpen(true)}><FiGrid aria-hidden="true" /><span>More</span></button>}</nav>}
      </div>
    </div>
  );
}
