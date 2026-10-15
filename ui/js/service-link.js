// @ts-check
/* The address a widget reads its service from, as a link for the reader's
   browser. Keep it free of the DOM and of imports: the API requires it. */

/** The service address as a link a browser can open, or '' when the browser
    cannot reach it: a container name, a loopback address, or no address.
    Credentials, query and fragment are dropped, since a query can carry a key.
    @param {unknown} raw @returns {string} */
export function browserLink(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  let s = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
  let u;
  try {
    u = new URL(s);
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'host.docker.internal') return '';
  if (host === '::1' || host === '0.0.0.0' || /^127\./.test(host)) return '';
  if (!host.includes('.') && !host.includes(':')) return '';
  u.username = '';
  u.password = '';
  u.search = '';
  u.hash = '';
  return u.href.replace(/\/+$/, '');
}
