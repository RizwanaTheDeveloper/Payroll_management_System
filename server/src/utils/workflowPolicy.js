// Shared approval-workflow policy.
//
// Requests go to the employee's line manager first (or straight to an administrator when the
// employee has no manager). A request still undecided after this many days is treated as
// escalated: it also appears in the administrator's queue so work is never stuck with an absent manager.
const ESCALATE_AFTER_DAYS = Number(process.env.APPROVAL_ESCALATION_DAYS) > 0
  ? Number(process.env.APPROVAL_ESCALATION_DAYS) : 3;

// How far back an employee may ask for an attendance correction.
const ATTENDANCE_REQUEST_WINDOW_DAYS = 60;

module.exports = { ESCALATE_AFTER_DAYS, ATTENDANCE_REQUEST_WINDOW_DAYS };
