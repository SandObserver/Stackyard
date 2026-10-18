const { loadConfig } = require('./config');
const { authActive } = require('./auth');
const { IS_DEMO } = require('./demo');
const { hostnameOf, isLocalAddress } = require('../../ui/js/host-names.js');

/* While no password is set, answer only addresses a page on another site
   cannot point at this server (DNS rebinding). Never add a name to the list
   from a request: a rebound page can send that request first. */

/** @returns {string | null} the refused host name, or null when allowed */
function refusedHost(req) {
  if (IS_DEMO) return null;
  const cfg = loadConfig();
  if (authActive(cfg)) return null;
  const host = hostnameOf(req.headers.host);
  if (!host) return String(req.headers.host || '');
  const list = cfg.settings?.server?.allowedHosts;
  return isLocalAddress(host) || (Array.isArray(list) && list.includes(host)) ? null : host;
}

module.exports = { refusedHost };
