const { loadConfig } = require('./config');
const { authActive } = require('./auth');
const { IS_DEMO } = require('./demo');
const { hostnameOf, isLocalAddress } = require('../../ui/js/host-names.js');

/* While no password is set, answer only addresses a page on another site
   cannot point at this server (DNS rebinding). Never add a name to the list
   from a request: a rebound page can send that request first. */

/** @returns {boolean} whether the request names a local address or a listed one */
function knownHost(req, cfg) {
  const host = hostnameOf(req.headers.host);
  if (!host) return false;
  const list = cfg.settings?.server?.allowedHosts;
  return isLocalAddress(host) || (Array.isArray(list) && list.includes(host));
}

/** @returns {string | null} the refused host name, or null when allowed */
function refusedHost(req) {
  if (IS_DEMO) return null;
  const cfg = loadConfig();
  if (authActive(cfg) || knownHost(req, cfg)) return null;
  return hostnameOf(req.headers.host) || String(req.headers.host || '');
}

module.exports = { refusedHost, knownHost };
