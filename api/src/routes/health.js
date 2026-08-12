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
const { PING_MS } = require('../timeouts');
const { IS_DEMO } = require('../demo');
const demoData = require('../demo-data');
const log = require('../log');
const SOCKET_PROXY_URL_DEFAULT = process.env.SOCKET_PROXY_URL || '';

async function fetchContainerHealth() {
  const cfg = loadConfig();
  const socketUrl = cfg.settings?.server?.socketProxyUrl || SOCKET_PROXY_URL_DEFAULT;
  if (!socketUrl) return Object.create(null);
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

/* The two address shapes fail for opposite reasons, and neither error text says
   so on its own. A service name is resolved by Docker's own DNS, which answers
   only for containers sharing a network. An IP reaches only what the proxy
   published: a proxy bound to the host's loopback, as the usual compose does,
   is unreachable from inside any container, at any address.

   The hint names which of the two applies. The UI translates it; the codes are
   the contract between them. */
const HINT = Object.freeze({ SHARED_NETWORK: 'shared-network', PUBLISH_PORT: 'publish-port' });

/* A packet to a port bound on another namespace's loopback is dropped rather
   than refused, so this case arrives as a timeout. Left non-fatal it saved with
   a warning, which is the exact silence this probe exists to end. A literal
   address is also never the one that is still starting up under a name. */
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
    return { ok: false, fatal: true, error: 'That is not a valid URL.' };
  }
  const policy = urlPolicyError(u);
  if (policy) return { ok: false, fatal: true, error: policy };
  try {
    const r = await fetchUnchecked(`${url.replace(/\/+$/, '')}/version`, { timeout: PING_MS });
    if (r.status === 401 || r.status === 403)
      return { ok: false, fatal: true, error: 'The socket proxy refused the request.' };
    if (r.status >= 400) return { ok: false, fatal: true, error: `The address answered with HTTP ${r.status}.` };
    if (!r.data || typeof r.data !== 'object' || !r.data.ApiVersion)
      return { ok: false, fatal: true, error: 'Something is listening there, but it is not a Docker socket proxy.' };
    return { ok: true, version: String(r.data.ApiVersion) };
  } catch (e) {
    const host = bareHost(u.hostname);
    const code = errCode(e) ?? '';
    const fatal = WRONG_ADDRESS_CODES.has(code) || (!code && isLiteralAddress(host));
    return { ok: false, fatal, error: pingErrorText(e), hint: addressHint(host) };
  }
}

on('POST', '/api/docker/test', async (req, res) => {
  if (!checkOrigin(req, res)) return;
  const limited = rateLimit(getIp(req), 'docker-test', 20, 60_000);
  if (limited) return json(res, 429, { ok: false, error: limited, kind: KIND.BLOCKED });
  try {
    const { url } = JSON.parse(await readBody(req));
    if (!url || typeof url !== 'string')
      return json(res, 400, { ok: false, error: 'url required', kind: KIND.INVALID });
    json(res, 200, await probeSocketProxy(url.trim()));
  } catch {
    json(res, 400, { ok: false, error: 'url required', kind: KIND.INVALID });
  }
});

on('GET', '/health', (_, res) => json(res, 200, { ok: true }));

on('GET', '/api/health', async (req, res) => {
  const limited = rateLimit(getIp(req), 'health', LIMITS.HEALTH.max, LIMITS.HEALTH.windowMs);
  if (limited) return json(res, 429, { error: limited, kind: KIND.BLOCKED });
  if (IS_DEMO) {
    const cfg = loadConfig();
    return json(res, 200, demoData.demoHealth(cfg.items));
  }
  const containers = await fetchContainerHealth();
  const cfg = loadConfig(),
    result = Object.create(null);
  await Promise.allSettled(
    cfg.items
      .filter(i => i.type === 'app' && (i.container || i.ping || i.monitoring?.healthcheck?.enabled))
      .map(async item => {
        const mon = item.monitoring?.healthcheck || {};
        const cName = mon.container || item.container || '';
        const ping = mon.pingUrl || item.ping || '';
        /* Build the entry up rather than replace it. An item can have both a
           container and a ping, and the tile needs the detail from each. */
        let unhealthy = false;
        const detail = {};
        if (cName) {
          const norm = cName.toLowerCase().replace(/[\s_]+/g, '-');
          const c = containers[cName] || containers[norm];
          unhealthy = !c || c.unhealthy;
          detail.state = c?.state || 'unknown';
          detail.status = c?.status || '';
        }
        if (ping) {
          const r = await pingUnchecked(ping, PING_MS, item.skipTlsVerify === true);
          if (!r.ok) unhealthy = true;
          detail.pingStatus = r.status;
          detail.pingError = r.error;
        }
        result[item.id] = { unhealthy, ...detail };
      }),
  );
  json(res, 200, result);
});
