const { loadConfig, loadConfigForUpdate, saveConfig } = require('./config');
const { authActive } = require('./auth');
const { IS_DEMO } = require('./demo');
const log = require('./log');
const { hostnameOf, isLocalAddress } = require('../../ui/js/host-names.js');

/* While no password is set, a page on another site can point its own name at
   this server and read or write everything (DNS rebinding). Only addresses no
   such page can use are answered: local ones, and the ones the owner allowed.

   The first page load decides the list when none is stored: a host name is
   trusted and saved, an IP address saves an empty list. */

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
