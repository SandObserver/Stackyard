/* Every item-level secret system in one place, so a route handling a full config
   cannot run some of them and miss others. Settings-level secrets are not item
   secrets and stay in the config route. */

const { scrubConfigSecrets, preserveConfigSecrets } = require('./widget-secrets');
const { scrubItemBadgeSecrets, preserveItemBadgeSecrets } = require('./badge-headers');

function scrubAllSecrets(cfg) {
  scrubConfigSecrets(cfg);
  if (Array.isArray(cfg.items)) {
    for (const item of cfg.items) if (item && item.type === 'app') scrubItemBadgeSecrets(item);
  }
  return cfg;
}

function preserveAllSecrets(newCfg, oldCfg) {
  preserveConfigSecrets(newCfg, oldCfg);
  if (Array.isArray(newCfg.items)) {
    for (const item of newCfg.items) {
      if (item?.type !== 'app') continue;
      const prev = oldCfg?.items?.find(e => e && e.id === item.id);
      preserveItemBadgeSecrets(item, prev);
    }
  }
  return newCfg;
}

module.exports = { scrubAllSecrets, preserveAllSecrets };
