const { loadConfig } = require('./config');
const { authActive } = require('./auth');
const { IS_DEMO } = require('./demo');
const { hostnameOf, isLocalAddress } = require('../../ui/js/host-names.js');
const { proxied } = require('./front-proxy');

/* While no password is set, answer only addresses a page on another site
   cannot point at this server (DNS rebinding). Never add a name to the list
   from a request: a rebound page can send that request first. */

/** @returns {boolean} whether the request names a local address or a listed one */
function knownHost(req, cfg) {
  const host = hostnameOf(req.headers.host);
  if (!host) return false;
  return isLocalAddress(host) || listed(cfg, host);
}

const listed = (cfg, host) => {
  const list = cfg.settings?.server?.allowedHosts;
  return !!host && Array.isArray(list) && list.includes(host);
};

/** The proxied name this request would lose if protection went off with this
    list, or null. @returns {string | null} */
function proxiedNameLost(req, list) {
  if (!proxied(req)) return null;
  const hosts = Array.isArray(list) ? list : [];
  const host = hostnameOf(req.headers.host);
  if (host && hosts.includes(host)) return null;
  return host || null;
}

/** @returns {string | null} the refused host name, or null when allowed */
function refusedHost(req) {
  if (IS_DEMO) return null;
  const cfg = loadConfig();
  if (authActive(cfg)) return null;
  const host = hostnameOf(req.headers.host);
  /* Only a listed Host through a proxy. A proxy can send an IP or a one-label
     name as Host for a request from the internet. Never read X-Forwarded-Host.
     A client can set it. */
  if (proxied(req)) {
    if (listed(cfg, host)) return null;
    return host || String(req.headers.host || '');
  }
  if (knownHost(req, cfg)) return null;
  return host || String(req.headers.host || '');
}

module.exports = { refusedHost, knownHost, proxiedNameLost };
