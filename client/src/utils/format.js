// Display formatting shared by the newer screens: Indian dates and rupees, never raw ISO or snake_case.
const IST = 'Asia/Kolkata';

export function formatDate(value) {
  if (!value) return '-';
  const text = String(value);
  const date = new Date(text.length <= 10 ? `${text}T00:00:00` : text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: text.length <= 10 ? undefined : IST });
}

export function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST });
}

export function formatINR(value, digits = 0) {
  return Number(value || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: digits, maximumFractionDigits: 2 });
}

export const titleCase = (value) => String(value ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
