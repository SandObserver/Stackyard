/* Keep every request read-only. Transmission and Deluge take a POST body: keep
   its method names fixed here. A method taken from config turns this into a
   relay that can change or delete downloads. */

const items = require('./download-items');

const FETCH_MS = 8000;

const authKind = (status, ctx) => ([401, 403].includes(status) ? ctx.KIND.AUTH : ctx.KIND.UPSTREAM);

function required(value, message, ctx) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) ctx.fail(message, { kind: ctx.KIND.INVALID });
  return v;
}

/* A key goes into a request header as typed. */
const HEADER_SAFE = /^[\x21-\x7e]+$/;
function headerKey(value, message, ctx) {
  const v = required(value, message, ctx);
  if (!HEADER_SAFE.test(v)) ctx.fail('The API key has characters a key cannot hold', { kind: ctx.KIND.INVALID });
  return v;
}

function login(ctx) {
  const username = String(ctx.config.username || '').trim();
  if (username.includes(':')) ctx.fail('A username cannot contain a colon', { kind: ctx.KIND.INVALID });
  return basicAuth(username, String(ctx.config.password || ''));
}

/* Per server. Bounded: a preview can name any address. */
const SESSIONS_KEPT = 32;
function remember(map, key, value) {
  map.delete(key);
  map.set(key, value);
  if (map.size > SESSIONS_KEPT) map.delete(map.keys().next().value);
}

function basicAuth(username, password) {
  return username || password
    ? { Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') }
    : {};
}

function connection(ctx) {
  const c = ctx.config;
  return {
    base: ctx.normalizeBase(required(c.url, 'Enter the download client address', ctx)),
    skipTls: c.skipTls === true,
  };
}

/* qBittorrent 5.3 reports a paused session only in its sync feed. The first
   read sends every torrent; later reads with the returned rid send changes
   only, and `session_state` only when it changes. Kept per server. */
const _qbitSync = new Map();
/* A list too large to read once is retried after this long. */
const QBIT_RETRY_MS = 24 * 3600 * 1000;

async function qbitPaused(get, base) {
  const known = _qbitSync.get(base) || { rid: 0, paused: false };
  if (known.tooLargeAt && Date.now() - known.tooLargeAt < QBIT_RETRY_MS) return false;
  let d;
  try {
    d = await get(`/sync/maindata?rid=${known.rid}`, false);
  } catch (e) {
    if (e && e.responseTooLarge) remember(_qbitSync, base, { rid: 0, paused: false, tooLargeAt: Date.now() });
    return known.paused;
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
  const next = {
    rid: Number.isSafeInteger(d.rid) && d.rid >= 0 ? d.rid : 0,
    paused: d.full_update === true ? false : known.paused,
  };
  const state = d.server_state && d.server_state.session_state;
  if (typeof state === 'boolean') next.paused = state;
  remember(_qbitSync, base, next);
  return next.paused;
}

async function qbittorrent(ctx) {
  const { base, skipTls } = connection(ctx);
  const key = headerKey(ctx.config.apiKey, 'Enter the qBittorrent API key', ctx);
  const get = async (path, list = true) => {
    const r = await ctx.fetchJSON(`${base}/api/v2${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      skipTls,
      timeout: FETCH_MS,
    });
    if (r.status === 401 || r.status === 403)
      ctx.fail('qBittorrent refused the API key. It needs qBittorrent 5.2 or newer.', { kind: ctx.KIND.AUTH });
    if (r.status !== 200) ctx.fail(`qBittorrent returned HTTP ${r.status}`, { kind: ctx.KIND.UPSTREAM });
    if (list && !Array.isArray(r.data))
      ctx.fail('qBittorrent sent a reply in an unexpected shape', { kind: ctx.KIND.UPSTREAM });
    return r.data;
  };
  const [active, failed, done, paused] = await Promise.all([
    get('/torrents/info?filter=downloading'),
    get('/torrents/info?filter=errored'),
    get('/torrents/info?filter=completed&sort=completion_on&reverse=true&limit=100').catch(() => []),
    qbitPaused(get, base),
  ]);
  return { found: items.qbitItems([...active, ...failed]), finished: items.qbitFinished(done), paused };
}

async function sabnzbd(ctx) {
  const { base, skipTls } = connection(ctx);
  const key = required(ctx.config.apiKey, 'Enter the SABnzbd API key', ctx);
  const get = async (mode, extra = '') => {
    const r = await ctx.fetchJSON(`${base}/api?mode=${mode}${extra}&output=json&apikey=${encodeURIComponent(key)}`, {
      skipTls,
      timeout: FETCH_MS,
    });
    if (r.status === 401 || r.status === 403) ctx.fail('SABnzbd refused the API key', { kind: ctx.KIND.AUTH });
    if (r.status !== 200) ctx.fail(`SABnzbd returned HTTP ${r.status}`, { kind: ctx.KIND.UPSTREAM });
    if (!r.data || typeof r.data !== 'object' || !r.data[mode])
      ctx.fail('SABnzbd sent a reply in an unexpected shape', { kind: ctx.KIND.UPSTREAM });
    return r.data[mode];
  };
  const [queue, history] = await Promise.all([get('queue'), get('history', '&limit=100').catch(() => null)]);
  return {
    found: items.sabItems(queue),
    finished: history ? items.sabFinished(history) : [],
    paused: queue.paused === true,
  };
}

async function nzbget(ctx) {
  const { base, skipTls } = connection(ctx);
  const headers = login(ctx);
  const call = async method => {
    const r = await ctx.fetchJSON(`${base}/jsonrpc/${method}`, { headers, skipTls, timeout: FETCH_MS });
    if (r.status === 401 || r.status === 403)
      ctx.fail('NZBGet refused the username or password', { kind: ctx.KIND.AUTH });
    if (r.status !== 200) ctx.fail(`NZBGet returned HTTP ${r.status}`, { kind: ctx.KIND.UPSTREAM });
    if (!r.data || typeof r.data !== 'object' || !('result' in r.data))
      ctx.fail('NZBGet sent a reply in an unexpected shape', { kind: ctx.KIND.UPSTREAM });
    return r.data.result;
  };
  const [status, groups, history] = await Promise.all([
    call('status'),
    call('listgroups'),
    call('history').catch(() => []),
  ]);
  return {
    found: items.nzbgetItems(groups, status),
    finished: items.nzbgetFinished(history),
    paused: !!status && status.DownloadPaused === true,
  };
}

/* Transmission answers 409 with a session id that every request must carry.
   Versions before 4.1 do not speak JSON-RPC 2.0. */
const _transmission = new Map();

function transmissionRpcUrl(base) {
  return /\/rpc$/.test(new URL(base).pathname) ? base : `${base}/transmission/rpc`;
}

const T_FIELDS = [
  'name',
  'status',
  'error',
  'eta',
  'size_when_done',
  'left_until_done',
  'rate_download',
  'is_stalled',
  'percent_done',
  'done_date',
];
const toCamel = s => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

async function transmission(ctx) {
  const { base, skipTls } = connection(ctx);
  const url = transmissionRpcUrl(base);
  const auth = login(ctx);
  const known = _transmission.get(url) || { session: '', legacy: false };

  const post = async (body, session) => {
    const r = await ctx.fetchJSON(url, {
      method: 'POST',
      headers: {
        ...auth,
        'Content-Type': 'application/json',
        ...(session ? { 'X-Transmission-Session-Id': session } : {}),
      },
      body: JSON.stringify(body),
      skipTls,
      timeout: FETCH_MS,
      withHeaders: true,
      raw: true,
    });
    if (r.status === 401 || r.status === 403)
      ctx.fail('Transmission refused the username or password', { kind: ctx.KIND.AUTH });
    return r;
  };
  const send = async (body, conn) => {
    let r = await post(body, conn.session);
    if (r.status === 409) {
      const fresh = r.headers && r.headers['x-transmission-session-id'];
      if (!fresh) ctx.fail('Transmission sent no session id', { kind: ctx.KIND.UPSTREAM });
      conn.session = String(fresh);
      r = await post(body, conn.session);
    }
    if (r.status !== 200) ctx.fail(`Transmission returned HTTP ${r.status}`, { kind: authKind(r.status, ctx) });
    try {
      return JSON.parse(r.data);
    } catch {
      return ctx.fail('Transmission sent a reply that is not JSON', { kind: ctx.KIND.UPSTREAM });
    }
  };

  const state = { ...known };
  let torrents = null;
  if (!state.legacy) {
    const reply = await send({ jsonrpc: '2.0', method: 'torrent_get', params: { fields: T_FIELDS }, id: 1 }, state);
    if (reply && reply.jsonrpc === '2.0' && Array.isArray(reply.result?.torrents)) torrents = reply.result.torrents;
    else if (reply && reply.jsonrpc === '2.0')
      ctx.fail('Transmission could not list torrents', { kind: ctx.KIND.UPSTREAM });
    else state.legacy = true;
  }
  if (!torrents) {
    const reply = await send({ method: 'torrent-get', arguments: { fields: T_FIELDS.map(toCamel) } }, state);
    if (reply?.result !== 'success' || !Array.isArray(reply.arguments?.torrents))
      ctx.fail('Transmission could not list torrents', { kind: ctx.KIND.UPSTREAM });
    torrents = reply.arguments.torrents;
  }
  remember(_transmission, url, state);
  return { found: items.transmissionItems(torrents), finished: items.transmissionFinished(torrents) };
}

/* Deluge's web UI lists no torrents until it is connected to a daemon. */
const _deluge = new Map();
const D_FIELDS = [
  'name',
  'state',
  'total_wanted',
  'total_done',
  'download_payload_rate',
  'eta',
  'num_seeds',
  'is_finished',
  'completed_time',
];

async function deluge(ctx) {
  const { base, skipTls } = connection(ctx);
  const password = required(ctx.config.password, 'Enter the Deluge web password', ctx);
  const url = `${base}/json`;
  let id = 0;
  const rpc = async (method, params, session) => {
    const r = await ctx.fetchJSON(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session } : {}) },
      body: JSON.stringify({ method, params, id: ++id }),
      skipTls,
      timeout: FETCH_MS,
      withHeaders: true,
    });
    if (r.status !== 200) ctx.fail(`Deluge returned HTTP ${r.status}`, { kind: authKind(r.status, ctx) });
    if (!r.data || typeof r.data !== 'object')
      ctx.fail('Deluge sent a reply in an unexpected shape', { kind: ctx.KIND.UPSTREAM });
    return r;
  };
  const signIn = async () => {
    const r = await rpc('auth.login', [password]);
    if (r.data.result !== true) ctx.fail('Deluge refused the password', { kind: ctx.KIND.AUTH });
    const set = [].concat(r.headers?.['set-cookie'] || []).map(String);
    const cookie = set.map(c => c.split(';')[0]).find(c => c.startsWith('_session_id='));
    if (!cookie) ctx.fail('Deluge sent no session cookie', { kind: ctx.KIND.UPSTREAM });
    remember(_deluge, url, { cookie, password });
    return cookie;
  };
  const cached = _deluge.get(url);
  let cookie = cached && cached.password === password ? cached.cookie : await signIn();

  const authed = async (method, params) => {
    let r = await rpc(method, params, cookie);
    if (r.data.error && r.data.error.code === 1) {
      cookie = await signIn();
      r = await rpc(method, params, cookie);
    }
    if (r.data.error) ctx.fail('Deluge could not answer', { kind: ctx.KIND.UPSTREAM });
    return r.data.result;
  };

  if ((await authed('web.connected', [])) !== true) {
    /* Connect only to the one daemon there is. The web UI's connection is
       shared, so guessing among several moves every other user to it. */
    const hosts = await authed('web.get_hosts', []);
    const list = Array.isArray(hosts) ? hosts : [];
    if (list.length > 1) ctx.fail('Deluge is not connected to a daemon', { kind: ctx.KIND.UPSTREAM });
    const host = Array.isArray(list[0]) ? list[0][0] : null;
    if (typeof host !== 'string') ctx.fail('Deluge has no daemon to connect to', { kind: ctx.KIND.UPSTREAM });
    await authed('web.connect', [host]);
  }
  const ui = await authed('web.update_ui', [D_FIELDS, {}]);
  const torrents = ui && typeof ui === 'object' ? ui.torrents : null;
  const paused = await authed('core.is_session_paused', []).catch(() => false);
  return { found: items.delugeItems(torrents), finished: items.delugeFinished(torrents), paused: paused === true };
}

module.exports = async function (ctx) {
  const out = await ctx.dispatchProvider(
    { qbittorrent, sabnzbd, nzbget, transmission, deluge },
    { field: 'service', default: 'qbittorrent' },
  );
  return {
    ...items.arrange(out.found, out.paused === true),
    finished: items.finishedTimes(out.finished),
    link: ctx.serviceLink(ctx.config.href, ctx.config.url),
  };
};
