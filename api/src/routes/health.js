const { on, json, getIp, readBody, checkOrigin } = require('../router');
const { rateLimit } = require('../auth');
const { KIND } = require('../api-error');
const LIMITS = require('../poll-limits');
const { loadConfig } = require('../config');
const {
  fetchUnchecked,
  pingUnchecked,
  urlPolicyError,
  pingErrorText,
  errCode,
  bareHost,
  isDockerServiceName,
  isPrivateAddress,
} = require('../proxy');
const { PING_MS, BATCH_MS } = require('../timeouts');
const backoff = require('../poll-backoff');
const { latest } = require('../latest');
const { IS_DEMO } = require('../demo');
const demoData = require('../demo-data');
const log = require('../log');
const proxmox = require('../proxmox');
const { RETYPE_MESSAGE } = require('../secret-scope');
const { errorBody } = require('../api-error');
const SOCKET_PROXY_URL_DEFAULT = process.env.SOCKET_PROXY_URL || '';
const CONTAINERS_KEEP_MS = 2 * 60 * 1000;

/** @param {any} item */
function guestOf(item) {
  const hc = item?.monitoring?.healthcheck;
  if (!hc?.enabled) return null;
  const id = Number(hc.proxmoxGuest);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function socketProxyUrl(cfg) {
  return cfg.settings?.server?.socketProxyUrl || SOCKET_PROXY_URL_DEFAULT;
}

async function fetchContainerHealth(socketUrl) {
  try {
    const r = await fetchUnchecked(`${socketUrl}/containers/json?all=true`);
    if (!Array.isArray(r.data)) return Object.create(null);
    /* Null prototype. Keys are container names, so on an ordinary object a
       container called "constructor" matches an inherited value and one that
       does not exist reports healthy. */
    const out = Object.create(null);
    for (const c of r.data) {
      for (const name of c.Names || []) {
        const clean = name.replace(/^\//, '');
        const norm = clean.toLowerCase().replace(/[\s_]+/g, '-');
        const entry = {
          state: c.State,
          status: c.Status || '',
          unhealthy: c.State !== 'running' || (c.Status || '').toLowerCase().includes('unhealthy'),
        };
        out[clean] = entry;
        out[norm] = entry;
      }
    }
    return out;
  } catch (e) {
    log.error('container health fetch failed', { error: e.message });
    return Object.create(null);
  }
}

/* These codes mean the address itself is wrong. A timeout is not among them: a
   proxy that is still starting produces one, and refusing that save locks the
   field on an address that is about to work. */
const WRONG_ADDRESS_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPROTO',
]);

/* The two address shapes fail for opposite reasons. A service name resolves
   only for containers sharing a network. An IP reaches only what the proxy
   published, and a proxy bound to the host's loopback is unreachable from
   inside any container. These codes are the contract with the UI, which turns
   them into advice. */
const HINT = Object.freeze({ SHARED_NETWORK: 'shared-network', PUBLISH_PORT: 'publish-port' });

/* A packet to a port bound on another namespace's loopback is dropped rather
   than refused, so this case arrives as a timeout. A literal address is never
   the one that is still starting up under a name. */
const isLiteralAddress = host => isPrivateAddress(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');

function addressHint(host) {
  if (isDockerServiceName(host)) return HINT.SHARED_NETWORK;
  return HINT.PUBLISH_PORT;
}

/* A Docker API answers /version with an ApiVersion. Anything else on that port
   would be stored as a working address and report every container as down. */
async function probeSocketProxy(url) {
  /* Outbound requests are disabled in the demo, so every address fails the
     probe. */
  if (IS_DEMO) return { ok: true };
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, fatal: true, error: 'That is not a valid URL.', code: 'invalid.url' };
  }
  const policy = urlPolicyError(u);
  if (policy) return { ok: false, fatal: true, error: policy, code: 'invalid.url' };
  try {
    const r = await fetchUnchecked(`${url.replace(/\/+$/, '')}/version`, { timeout: PING_MS });
    if (r.status === 401 || r.status === 403)
      return { ok: false, fatal: true, error: 'The socket proxy refused the request.', code: 'upstream.refused' };
    if (r.status >= 400)
      return {
        ok: false,
        fatal: true,
        error: `The address answered with HTTP ${r.status}.`,
        code: 'upstream.status',
        detail: { status: r.status },
      };
    if (!r.data || typeof r.data !== 'object' || !r.data.ApiVersion)
      return {
        ok: false,
        fatal: true,
        error: 'Something is listening there, but it is not a Docker socket proxy.',
        code: 'upstream.not-docker',
      };
    return { ok: true, version: String(r.data.ApiVersion) };
  } catch (e) {
    const host = bareHost(u.hostname);
    const code = errCode(e) ?? '';
    const fatal = WRONG_ADDRESS_CODES.has(code) || (!code && isLiteralAddress(host));
    return { ok: false, fatal, error: pingErrorText(e), code: 'network', hint: addressHint(host) };
  }
}

on('POST', '/api/docker/test', async (req, res) => {
  if (!checkOrigin(req, res)) return;
  const limited = rateLimit(getIp(req), 'docker-test', 20, 60_000);
  if (limited) return json(res, 429, { ok: false, error: limited, kind: KIND.BLOCKED, code: 'blocked.rate-limit' });
  try {
    const { url } = JSON.parse(await readBody(req));
    if (!url || typeof url !== 'string')
      return json(res, 400, { ok: false, error: 'url required', kind: KIND.INVALID });
    json(res, 200, await probeSocketProxy(url.trim()));
  } catch {
    json(res, 400, { ok: false, error: 'url required', kind: KIND.INVALID });
  }
});

const MISSING = Object.freeze({
  error: 'Enter the Proxmox address, token ID and secret.',
  kind: KIND.INVALID,
  code: 'invalid.proxmox-missing',
});

/* A test that leaves the secret blank uses the stored one, but only for the
   address and token it was stored for. */
on('POST', '/api/proxmox/test', async (req, res) => {
  if (!checkOrigin(req, res)) return;
  const limited = rateLimit(getIp(req), 'proxmox-test', 20, 60_000);
  if (limited) return json(res, 429, { ok: false, error: limited, kind: KIND.BLOCKED, code: 'blocked.rate-limit' });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { ok: false, error: 'url and tokenId required', kind: KIND.INVALID });
  }
  const server = {
    proxmox: { url: body?.url, tokenId: body?.tokenId, secret: body?.secret, skipTlsVerify: body?.skipTlsVerify },
  };
  const dropped = proxmox.preserveProxmox(server, loadConfig().settings?.server, false);
  if (!server.proxmox.secret && dropped)
    return json(res, 200, { ok: false, error: RETYPE_MESSAGE, kind: KIND.INVALID, code: 'invalid.retype' });
  const conn = proxmox.connectionOf(server);
  if (!conn) return json(res, 200, { ok: false, ...MISSING });
  if (IS_DEMO) return json(res, 200, { ok: true, guests: 0 });
  try {
    const guests = await proxmox.listGuests(conn, proxmox.TEST_MS);
    json(res, 200, { ok: true, guests: guests.length });
  } catch (e) {
    json(res, 200, { ok: false, ...errorBody(e) });
  }
});

on('GET', '/api/proxmox/guests', async (req, res) => {
  const limited = rateLimit(getIp(req), 'proxmox-guests', 30, 60_000);
  if (limited) return json(res, 429, { error: limited, kind: KIND.BLOCKED, code: 'blocked.rate-limit' });
  if (IS_DEMO) return json(res, 200, { guests: demoData.demoProxmoxGuests() });
  const conn = proxmox.connectionOf(loadConfig().settings?.server);
  if (!conn) return json(res, 400, MISSING);
  try {
    const guests = await proxmox.listGuests(conn, proxmox.TEST_MS);
    json(res, 200, { guests: guests.map(({ vmid, name, type, node }) => ({ vmid, name, type, node })) });
  } catch (e) {
    json(res, 502, errorBody(e));
  }
});

on('GET', '/health', (_, res) => json(res, 200, { ok: true }));

on('GET', '/api/health', async (req, res) => {
  const limited = rateLimit(getIp(req), 'health', LIMITS.HEALTH.max, LIMITS.HEALTH.windowMs);
  if (limited) return json(res, 429, { error: limited, kind: KIND.BLOCKED, code: 'blocked.rate-limit' });
  if (IS_DEMO) {
    const cfg = loadConfig();
    return json(res, 200, demoData.demoHealth(cfg.items));
  }
  const cfg = loadConfig();
  if (cfg.settings?.server?.healthChecks === false) return json(res, 200, {});
  const socketUrl = socketProxyUrl(cfg);
  /* Without a proxy address every container lookup misses, which would report
     every container-backed app as unhealthy. */
  const containersReady = socketUrl
    ? latest(`containers:${socketUrl}`, () => fetchContainerHealth(socketUrl), {
        holdMs: BATCH_MS,
        keepMs: CONTAINERS_KEEP_MS,
      }).then(o => (o?.ok ? o.value : Object.create(null)))
    : Promise.resolve(Object.create(null));
  const pve = proxmox.connectionOf(cfg.settings?.server);
  const wantsGuests = cfg.items.some(i => i.type === 'app' && guestOf(i) != null);
  const guestsReady = pve && wantsGuests ? proxmox.guestStates(pve) : null;
  const result = Object.create(null);
  await Promise.allSettled(
    cfg.items
      .filter(i => i.type === 'app' && (i.container || i.ping || i.monitoring?.healthcheck?.enabled))
      .map(async item => {
        const mon = item.monitoring?.healthcheck || {};
        const cName = socketUrl ? mon.container || item.container || '' : '';
        const ping = mon.pingUrl || item.ping || '';
        const vmid = guestOf(item);
        /* Build the entry up rather than replace it. An item can have both a
           container and a ping, and the tile needs the detail from each. */
        let unhealthy = false;
        const detail = {};
        const key = `ping:${item.id}`;
        const skipped = ping ? backoff.skip(key) : false;
        const pinged = ping && !skipped ? pingUnchecked(ping, BATCH_MS, item.skipTlsVerify === true) : null;
        if (cName) {
          const containers = await containersReady;
          const norm = cName.toLowerCase().replace(/[\s_]+/g, '-');
          const c = containers[cName] || containers[norm];
          unhealthy = !c || c.unhealthy;
          detail.state = c?.state || 'unknown';
          detail.status = c?.status || '';
        }
        if (ping) {
          /* status 0 is a host that never answered. A status of any kind means
             the address is reachable and stays on the normal cycle. */
          const r = skipped ? backoff.remembered(key) : await pinged;
          if (!r.ok) unhealthy = true;
          if (!skipped) {
            if (r.ok) backoff.success(key);
            else if (!r.status) backoff.failure(key, r);
          }
          detail.pingStatus = r.status;
          detail.pingError = r.error;
        }
        if (vmid != null) {
          const r = guestsReady
            ? await guestsReady
            : { error: 'Proxmox is not set up in Settings.', code: 'invalid.proxmox-missing' };
          if ('error' in r) {
            unhealthy = true;
            detail.proxmoxError = r.error;
            if (r.code) detail.proxmoxCode = r.code;
          } else {
            const g = r.guests.get(vmid);
            detail.guestState = g ? g.status : 'missing';
            if (detail.guestState !== 'running') unhealthy = true;
          }
        }
        if (cName || ping || vmid != null) result[item.id] = { unhealthy, ...detail };
      }),
  );
  json(res, 200, result);
});
