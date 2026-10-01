const { loadConfig, loadConfigForUpdate, saveConfig } = require('./config');
const { authActive } = require('./auth');
const { IS_DEMO } = require('./demo');
const log = require('./log');
const { hostnameOf, isLocalAddress } = require('../../ui/js/host-names.js');

/* While no password is set, answer only addresses a page on another site
   cannot point at this server (DNS rebinding). The first page load sets the
   list when none is stored. An IP address sets an empty one. */

/** @returns {string | null} the refused host name, or null when allowed */
function refusedHost(req, pathname) {
  if (IS_DEMO) return null;
  const cfg = loadConfig();
  if (authActive(cfg)) return null;
  const host = hostnameOf(req.headers.host);
  if (!host) return String(req.headers.host || '');
  const list = cfg.settings?.server?.allowedHosts;
  const local = isLocalAddress(host);
  if (!Array.isArray(list) && req.method === 'GET' && pathname === '/api/auth/check') {
    trustFirst(local ? [] : [host], host);
    return null;
  }
  return local || (Array.isArray(list) && list.includes(host)) ? null : host;
}

function trustFirst(list, host) {
  try {
    const cfg = loadConfigForUpdate();
    if (Array.isArray(cfg.settings?.server?.allowedHosts)) return;
    cfg.settings.server = { ...cfg.settings.server, allowedHosts: list };
    saveConfig(cfg);
    log.audit('allowed addresses set from the first visit', { host, allowed: list.join(',') || 'local only' });
  } catch (e) {
    log.warn('could not store the allowed addresses', { error: e.message });
  }
}

module.exports = { refusedHost };
