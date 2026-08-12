/* Every item-level secret system in one place. A route that runs some and
   misses others leaks a stored credential. */

const { scrubConfigSecrets, preserveConfigSecrets, secretSpec } = require('./widget-secrets');
const { scrubItemBadgeSecrets, preserveItemBadgeSecrets, toRows } = require('./badge-headers');
const { badgeRequestMatchesSaved, widgetConfigMatchesSaved } = require('./secret-scope');
const { getRegistry } = require('./widgets');

function scrubAllSecrets(cfg) {
  scrubConfigSecrets(cfg);
  if (Array.isArray(cfg.items)) {
    for (const item of cfg.items) if (item && item.type === 'app') scrubItemBadgeSecrets(item);
  }
  return cfg;
}

function rowsHoldSecret(rows) {
  return toRows(rows).some(r => r.secret && r.value != null && r.value !== '');
}

function blockHoldsSecret(block) {
  return !!block && (rowsHoldSecret(block.headers) || rowsHoldSecret(block.params));
}

const asRequest = block => ({ url: block?.url, headers: block?.headers, params: block?.params });

function widgetHoldsSecret(config, entry) {
  if (!config || !entry) return false;
  const { topLevel, groups, objects } = secretSpec(entry);
  const set = v => v != null && v !== '';
  if (topLevel.some(k => set(config[k]))) return true;
  for (const [gk, subKeys] of Object.entries(groups)) {
    if (Array.isArray(config[gk]) && config[gk].some(row => row && subKeys.some(sk => set(row[sk])))) return true;
  }
  for (const [ok, subKeys] of Object.entries(objects)) {
    if (config[ok] && subKeys.some(sk => set(config[ok][sk]))) return true;
  }
  return false;
}

/** Refill the secrets a save arrived without, but only for the items whose
    request is still the one the secret was stored for. Matching by item id
    alone sends a stored credential to a destination the incoming config names.

    @param {any} newCfg @param {any} oldCfg
    @returns {{ withheld: Array<{ id: string, label: string }> }} */
function preserveAllSecrets(newCfg, oldCfg) {
  const withheld = [];
  const note = item => {
    if (!withheld.some(w => w.id === item.id)) withheld.push({ id: item.id, label: item.label || item.id });
  };
  const oldItems = Array.isArray(oldCfg?.items) ? oldCfg.items : [];
  const prevOf = item => oldItems.find(e => e && e.id === item.id);

  if (Array.isArray(newCfg.items)) {
    const reg = getRegistry();
    const scopedForWidgets = { ...newCfg, items: [] };
    const keepWidget = new Map();
    for (const item of newCfg.items) {
      if (!item || item.type !== 'widget') continue;
      const prev = prevOf(item);
      const entry = reg[item.widgetType];
      const ok = !prev || !entry || widgetConfigMatchesSaved(item.widgetConfig || {}, prev.widgetConfig || {}, entry);
      keepWidget.set(item, ok);
      if (!ok && widgetHoldsSecret(prev.widgetConfig, entry)) note(item);
    }
    /* preserveConfigSecrets matches oldCfg.items by id. Hide an item from it to
       stop its secret being refilled. */
    scopedForWidgets.items = newCfg.items;
    const oldForWidgets = {
      ...oldCfg,
      items: oldItems.filter(o => {
        const match = newCfg.items.find(n => n && n.id === o.id && n.type === 'widget');
        return !match || keepWidget.get(match) !== false;
      }),
    };
    preserveConfigSecrets(scopedForWidgets, oldForWidgets);

    for (const item of newCfg.items) {
      if (item?.type !== 'app') continue;
      const prev = prevOf(item);
      if (!prev) {
        preserveItemBadgeSecrets(item, undefined);
        continue;
      }
      /* Judge each block on its own. They carry separate destinations. */
      const scoped = { ...prev };
      for (const [block, oldBlock, set] of [
        [item.badge, prev.badge, b => (scoped.badge = b)],
        [
          item.monitoring?.activity,
          prev.monitoring?.activity,
          b => (scoped.monitoring = { ...prev.monitoring, activity: b }),
        ],
      ]) {
        if (!block) continue;
        if (badgeRequestMatchesSaved(asRequest(block), oldBlock ? asRequest(oldBlock) : null)) continue;
        set(undefined);
        if (blockHoldsSecret(oldBlock)) note(item);
      }
      preserveItemBadgeSecrets(item, scoped);
    }
  }
  return { withheld };
}

module.exports = { scrubAllSecrets, preserveAllSecrets };
