import axios from 'axios';

const configuredApiUrl = import.meta.env.VITE_API_URL || '/api';
const trimmedApiUrl = configuredApiUrl.replace(/\/+$/, '');
const apiBaseUrl = trimmedApiUrl.endsWith('/api')
  ? trimmedApiUrl
  : `${trimmedApiUrl}/api`;

// Sign-in is a server-side session carried by an httpOnly cookie. The browser stores
// no token or profile (nothing in localStorage, sessionStorage or JavaScript-readable cookies).
const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  headers: { 'X-Requested-With': 'payroll-web' },
});

const SESSION_CHECK_URLS = ['/auth/login', '/auth/logout', '/auth/me'];

api.interceptors.response.use((response) => response, (error) => {
  if (error.response?.status === 401 && !SESSION_CHECK_URLS.includes(error.config?.url)) {
    window.dispatchEvent(new Event('payroll:session-expired'));
  }
  return Promise.reject(error);
});

export async function downloadPayslip(id) {
  const res = await api.get(`/payslips/${id}/download`, {
    responseType: 'blob',
  });

  const url = URL.createObjectURL(res.data);

  const a = document.createElement('a');
  a.href = url;
  // Use the "<Full Name> - <Month> <Year>.pdf" name chosen by the server.
  const header = res.headers?.['content-disposition'] || '';
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = header.match(/filename="([^"]+)"/i)?.[1];
  let fileName = plain || `payslip-${id}.pdf`;
  if (encoded) {
    try { fileName = decodeURIComponent(encoded); } catch { /* keep the plain name */ }
  }
  a.download = fileName;
  a.click();

  URL.revokeObjectURL(url);
}

export default api;
