/* Every item-level secret system that must run over a whole config, in one
   place. A route handling a full config calls these instead of sequencing each
   system by hand, so all of them run and a new secret shape is registered here
   once. Each underlying system keeps its own contract; this only fixes the order.
   Settings-level secrets (background key, auth) are not item secrets and stay in
   the config route. */

const { scrubConfigSecrets, preserveConfigSecrets } = require('./widget-secrets');
const { scrubItemBadgeSecrets, preserveItemBadgeSecrets } = require('./badge-headers');
const { applyBackupSlotDonors } = require('./backup-secrets');

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
    for (const item of newCfg.items) {
      if (item?.type === 'widget' && item.widgetType === 'backup')
        applyBackupSlotDonors(item.widgetConfig?.slots);
    }
  }
  return newCfg;
}

module.exports = { scrubAllSecrets, preserveAllSecrets };
