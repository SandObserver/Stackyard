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
  const host = u.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'host.docker.internal') return '';
  if (host === '::1' || host === '::' || host === '0.0.0.0' || /^127\./.test(host)) return '';
  const mapped = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(host);
  if (mapped && [0, 127].includes(parseInt(mapped[1], 16) >> 8)) return '';
  if (!host.includes('.') && !host.includes(':')) return '';
  u.username = '';
  u.password = '';
  u.search = '';
  u.hash = '';
  return u.href.replace(/\/+$/, '');
}

/** The address item pages go under, or '' when there is none. A Link URL the
    reader typed is trusted to be reachable, but only a bare address takes item
    paths: one with its own path, query or fragment points at a page.
    @param {unknown} own @param {unknown} url @returns {string} */
export function serviceBase(own, url) {
  const typed = typeof own === 'string' ? own.trim() : '';
  if (!typed) return browserLink(url);
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : 'http://' + typed);
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash || u.username || u.password) return '';
  return u.origin;
}

/** Where a widget opens. `own` is the Link URL the reader set; `url` is the
    address the server reads. With a `path`, the item's page under the service
    base, else `own` as typed.
    @param {unknown} own @param {unknown} url @param {string} [path] @returns {string} */
export function serviceLink(own, url, path = '') {
  const typed = typeof own === 'string' ? own.trim() : '';
  if (!path) return typed || browserLink(url);
  const base = serviceBase(typed, url);
  return base ? base + path : typed;
}
