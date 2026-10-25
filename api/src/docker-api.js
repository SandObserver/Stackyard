const { fetchUnchecked } = require('./proxy');

/* Socket proxy address -> engine API version. */
const prefixes = new Map();
const MAX_PREFIXES = 8;

/* The engine sets Api-Version on every reply, a rejected version included. A
   proxy's own refusal carries none. */
/** @param {string} base @param {object} opts @returns {Promise<string>} */
async function engineVersion(base, opts) {
  const r = await fetchUnchecked(`${base}/v1.24/version`, { ...opts, withHeaders: true });
  const v = String(r.headers?.['api-version'] || r.data?.ApiVersion || '');
  return /^1\.\d{1,3}$/.test(v) ? v : '';
}

/** @param {string} socketUrl @param {string} path starts with "/"
    @param {{ maxBytes?: number, timeout?: number }} [opts] */
async function dockerGet(socketUrl, path, opts = {}) {
  const base = socketUrl.replace(/\/+$/, '');
  const known = prefixes.get(base);
  if (known) {
    const r = await fetchUnchecked(`${base}/v${known}${path}`, opts);
    if (r.status >= 400) prefixes.delete(base);
    return r;
  }
  const r = await fetchUnchecked(`${base}${path}`, opts);
  if (r.status !== 401 && r.status !== 403) return r;
  const version = await engineVersion(base, opts);
  if (!version) return r;
  const retried = await fetchUnchecked(`${base}/v${version}${path}`, opts);
  if (retried.status < 400) {
    if (prefixes.size >= MAX_PREFIXES) prefixes.clear();
    prefixes.set(base, version);
  }
  return retried;
}

module.exports = { dockerGet };
