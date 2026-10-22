const { fetchUnchecked, pingErrorText } = require('./proxy');
const { KIND } = require('./api-error');
const { latest } = require('./latest');
const { BATCH_MS, PING_MS } = require('./timeouts');

const GUESTS_KEEP_MS = 2 * 60 * 1000;

/* user@realm!tokenid. Anything else in the header value is refused by Proxmox,
   and a line break would split the request. */
const TOKEN_ID = /^[^\s@!=]+@[^\s@!=]+![A-Za-z][A-Za-z0-9._-]*$/;
const SECRET = /^[A-Za-z0-9-]{1,128}$/;

const str = v => (typeof v === 'string' ? v.trim() : '');

/** @param {any} server @returns {{ url: string, tokenId: string, secret: string, skipTlsVerify: boolean } | null} */
function connectionOf(server) {
  const p = server?.proxmox;
  if (!p || typeof p !== 'object') return null;
  const url = str(p.url)
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  const tokenId = str(p.tokenId);
  const secret = str(p.secret);
  if (!url || !tokenId || !secret) return null;
  return { url, tokenId, secret, skipTlsVerify: p.skipTlsVerify === true };
}

/* The message reaches the browser verbatim. Never put upstream text in it. */
class ProxmoxError extends Error {
  /** @param {string} message @param {string} kind @param {string} apiCode @param {Record<string, unknown>} [detail] */
  constructor(message, kind, apiCode, detail) {
    super(message);
    this.vouchedMessage = message;
    this.kind = kind;
    this.apiCode = apiCode;
    if (detail) this.detail = detail;
  }
}

const badToken = () =>
  new ProxmoxError('The token ID must look like user@realm!name.', KIND.INVALID, 'invalid.proxmox-token');
const badUrl = () => new ProxmoxError('That is not a valid URL.', KIND.INVALID, 'invalid.url');

/** @param {unknown} e */
const reasonOf = e => (e instanceof ProxmoxError ? e.message : pingErrorText(e));

/** @param {{ url: string, tokenId: string, secret: string, skipTlsVerify: boolean }} conn @param {string} path */
async function pveGet(conn, path, timeout = BATCH_MS) {
  if (!TOKEN_ID.test(conn.tokenId) || !SECRET.test(conn.secret)) throw badToken();
  let base;
  try {
    base = new URL(conn.url);
  } catch {
    throw badUrl();
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw badUrl();
  const r = await fetchUnchecked(`${conn.url}/api2/json${path}`, {
    headers: { Authorization: `PVEAPIToken=${conn.tokenId}=${conn.secret}` },
    timeout,
    skipTls: conn.skipTlsVerify,
  });
  if (r.status === 401) throw new ProxmoxError('Proxmox refused the token.', KIND.UPSTREAM, 'upstream.proxmox-refused');
  if (r.status === 403)
    throw new ProxmoxError(
      'The token is missing a permission. Give it the PVEAuditor role.',
      KIND.UPSTREAM,
      'upstream.proxmox-permission',
    );
  if (r.status >= 400)
    throw new ProxmoxError(`Proxmox answered with HTTP ${r.status}.`, KIND.UPSTREAM, 'upstream.status', {
      status: r.status,
    });
  if (!r.data || typeof r.data !== 'object' || !('data' in r.data))
    throw new ProxmoxError(
      'Something is listening there, but it is not Proxmox.',
      KIND.UPSTREAM,
      'upstream.not-proxmox',
    );
  return r.data.data;
}

/** @returns {Promise<Array<{ vmid: number, name: string, type: string, node: string, status: string }>>} */
async function listGuests(conn, timeout) {
  const rows = await pveGet(conn, '/cluster/resources?type=vm', timeout);
  return (Array.isArray(rows) ? rows : [])
    .filter(g => g && (g.type === 'qemu' || g.type === 'lxc') && Number.isInteger(g.vmid) && !g.template)
    .map(g => ({
      vmid: g.vmid,
      name: typeof g.name === 'string' && g.name ? g.name : String(g.vmid),
      type: g.type,
      node: typeof g.node === 'string' ? g.node : '',
      status: typeof g.status === 'string' ? g.status : 'unknown',
    }))
    .sort((a, b) => a.vmid - b.vmid);
}

/** @returns {Promise<{ guests: Map<number, { status: string }> } | { error: string }>} */
async function guestStates(conn) {
  const key = `proxmox:${conn.url}|${conn.tokenId}|${conn.skipTlsVerify}`;
  const o = await latest(key, () => listGuests(conn, BATCH_MS), { holdMs: BATCH_MS, keepMs: GUESTS_KEEP_MS });
  if (!o) return { error: 'Proxmox did not answer in time.' };
  if (!o.ok) return { error: reasonOf(o.error) };
  return { guests: new Map(o.value.map(g => [g.vmid, { status: g.status }])) };
}

/* ── stored secret ─────────────────────────────────────────────────────── */

/** @param {any} server */
function scrubProxmox(server) {
  const p = server?.proxmox;
  if (!p || typeof p !== 'object') return;
  const set = !!str(p.secret);
  delete p.secret;
  p.secretSet = set;
}

/** Refills a blank secret only for the same address, token and certificate
    setting. Returns true when a stored secret was dropped.
    @param {any} server @param {any} prevServer @param {boolean} redirected */
function preserveProxmox(server, prevServer, redirected) {
  if (!server || typeof server !== 'object') return false;
  const p = server.proxmox;
  if (p == null) return false;
  if (typeof p !== 'object' || Array.isArray(p)) {
    delete server.proxmox;
    return false;
  }
  const next = { url: str(p.url), tokenId: str(p.tokenId), skipTlsVerify: p.skipTlsVerify === true };
  const typed = str(p.secret);
  const old = prevServer?.proxmox && typeof prevServer.proxmox === 'object' ? prevServer.proxmox : null;
  const oldSecret = str(old?.secret);
  let dropped = false;
  if (typed) next.secret = typed;
  else if (oldSecret) {
    const same =
      !redirected &&
      str(old.url) === next.url &&
      str(old.tokenId) === next.tokenId &&
      (old.skipTlsVerify === true) === next.skipTlsVerify;
    if (same) next.secret = oldSecret;
    else dropped = true;
  }
  server.proxmox = next;
  return dropped;
}

module.exports = {
  connectionOf,
  pveGet,
  listGuests,
  guestStates,
  scrubProxmox,
  preserveProxmox,
  ProxmoxError,
  TEST_MS: PING_MS,
};
