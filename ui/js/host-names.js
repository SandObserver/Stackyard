// @ts-check
/* Which addresses Stackyard answers on while no password is set. Keep it free
   of the DOM and of imports: the API requires it. */

export const ALLOWED_HOSTS_MAX = 50;

const LABEL = /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/* Names no public DNS answers for. A page elsewhere cannot point one of them
   at this server. */
const LOCAL_SUFFIXES = ['.localhost', '.local', '.home.arpa', '.internal'];

/** The lower-case host name in a Host header or typed address, without port,
    brackets or a trailing dot. Null when it is not a host name.
    @param {unknown} value @returns {string | null} */
export function hostnameOf(value) {
  if (typeof value !== 'string') return null;
  let s = value.trim().toLowerCase();
  if (!s || s.length > 300) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/\/.*$/, '');
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end < 0) return null;
    const rest = s.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return null;
    const ip = s.slice(1, end);
    return isIPv6(ip) ? ip : null;
  }
  if (isIPv6(s)) return s;
  const m = s.match(/^([^:]+)(?::(\d{1,5}))?$/);
  if (!m) return null;
  const name = m[1].replace(/\.$/, '');
  if (IPV4.test(name)) return isIPv4(name) ? name : null;
  if (name.length > 253 || !name.split('.').every(l => LABEL.test(l))) return null;
  return name;
}

/** @param {string} s */
function isIPv4(s) {
  const m = s.match(IPV4);
  return !!m && m.slice(1).every(n => Number(n) <= 255);
}

/** @param {string} s */
function isIPv6(s) {
  const bare = s.replace(/%[\w.-]+$/, '');
  if (!/^[0-9a-f:.]+$/.test(bare) || !bare.includes(':')) return false;
  try {
    return new URL(`http://[${bare}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}

/** True for an IP address, localhost, a single-label name and a reserved local
    name. These need no entry in the allowed list.
    @param {string} hostname from hostnameOf */
export function isLocalAddress(hostname) {
  if (isIPv4(hostname) || isIPv6(hostname)) return true;
  if (hostname === 'localhost' || !hostname.includes('.')) return true;
  return LOCAL_SUFFIXES.some(s => hostname.endsWith(s));
}

/** The list as stored: host names only, deduplicated. Null when an entry is
    not a host name or there are too many.
    @param {unknown} value @returns {string[] | null} */
export function normalizeHostList(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const entry of value) {
    const name = hostnameOf(entry);
    if (!name) return null;
    if (!out.includes(name)) out.push(name);
  }
  return out.length > ALLOWED_HOSTS_MAX ? null : out;
}

/** The first entry of a comma-separated list that is not a host name, or null.
    @param {string} text @returns {string | null} */
export function firstBadHost(text) {
  for (const part of String(text || '').split(',')) {
    const p = part.trim();
    if (p && !hostnameOf(p)) return p;
  }
  return null;
}

/** @param {string} text @returns {string[]} */
export function parseHostList(text) {
  return (
    normalizeHostList(
      String(text || '')
        .split(',')
        .map(p => p.trim())
        .filter(Boolean),
    ) || []
  );
}
