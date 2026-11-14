/* Every item-level secret system in one place. A route that runs some and
   misses others leaks a stored credential. */

const { scrubConfigSecrets, preserveConfigSecrets, secretSpec, RETYPE_FLAG } = require('./widget-secrets');
const {
  scrubItemBadgeSecrets,
  preserveItemBadgeSecrets,
  toRows,
  loginOf,
  wantsStoredSecret,
} = require('./badge-headers');
const { badgeRequestMatchesSaved, alignSavedConfig, rewriteChanged, widgetTlsChanged } = require('./secret-scope');
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
  return !!block && (rowsHoldSecret(block.headers) || rowsHoldSecret(block.params) || !!loginOf(block.login)?.password);
}

/* First match wins, as every other lookup by id does. */
/** @param {any[]} items @param {(item: any) => boolean} [keep] @returns {Map<any, any>} */
function firstById(items, keep = () => true) {
  const byId = new Map();
  for (const item of items) if (item && keep(item) && !byId.has(item.id)) byId.set(item.id, item);
  return byId;
}

const asRequest = block => ({ url: block?.url, headers: block?.headers, params: block?.params, login: block?.login });

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

const mayHoldSecret = (config, entry) =>
  entry ? widgetHoldsSecret(config, entry) : !!config && typeof config === 'object' && Object.keys(config).length > 0;

/** Refill the secrets a save arrived without, but only for the items whose
    request is still the one the secret was stored for. Matching by item id
    alone sends a stored credential to a destination the incoming config names.

    @param {any} newCfg @param {any} oldCfg
    @returns {{ withheld: Array<{ id: string, label: string }> }} */
function preserveAllSecrets(newCfg, oldCfg) {
  const withheld = [];
  const noted = new Set();
  const note = item => {
    if (noted.has(item.id)) return;
    noted.add(item.id);
    withheld.push({ id: item.id, label: item.label || item.id });
  };
  const savedItems = Array.isArray(oldCfg?.items) ? oldCfg.items : [];
  const savedById = firstById(savedItems);
  if (Array.isArray(newCfg.items)) for (const item of newCfg.items) if (item) delete item[RETYPE_FLAG];
  const redirected = rewriteChanged(newCfg.settings?.server, oldCfg?.settings?.server);
  if (redirected && Array.isArray(newCfg.items)) {
    const reg = getRegistry();
    for (const item of newCfg.items) {
      const prev = item && savedById.get(item.id);
      if (!prev) continue;
      const holds =
        prev.type === 'widget'
          ? mayHoldSecret(prev.widgetConfig, reg[prev.widgetType])
          : blockHoldsSecret(prev.badge) || blockHoldsSecret(prev.monitoring?.activity);
      if (holds) note(item);
    }
  }
  const prevOf = item => (redirected ? undefined : savedById.get(item.id));

  if (Array.isArray(newCfg.items)) {
    const reg = getRegistry();
    const scopedForWidgets = { ...newCfg, items: [] };
    /** @type {Map<any, any>} the saved item each widget may take secrets from, or null */
    const keepWidget = new Map();
    const tlsChanged = widgetTlsChanged(newCfg.settings?.server, oldCfg?.settings?.server);
    for (const item of newCfg.items) {
      if (!item || item.type !== 'widget') continue;
      const entry = reg[item.widgetType];
      const stored = savedById.get(item.id);
      if (!entry && stored?.type === 'widget' && stored.widgetType === item.widgetType) {
        const moved = redirected || tlsChanged;
        if (moved || stored[RETYPE_FLAG]) {
          keepWidget.set(item, stored);
          if (stored[RETYPE_FLAG] || mayHoldSecret(stored.widgetConfig, undefined)) item[RETYPE_FLAG] = true;
          if (moved && item[RETYPE_FLAG]) note(item);
          continue;
        }
      }
      const prev = prevOf(item);
      if (!prev) continue;
      const sameWidget =
        prev.type === 'widget' && prev.widgetType === item.widgetType && !tlsChanged && !prev[RETYPE_FLAG];
      if (!entry) {
        keepWidget.set(item, sameWidget ? prev : null);
        if (!sameWidget && mayHoldSecret(prev.widgetConfig, reg[prev.widgetType])) note(item);
        continue;
      }
      const aligned = sameWidget ? alignSavedConfig(item.widgetConfig || {}, prev.widgetConfig || {}, entry) : null;
      keepWidget.set(item, aligned ? { ...prev, widgetConfig: aligned.config } : null);
      if (aligned ? aligned.dropped : mayHoldSecret(prev.widgetConfig, reg[prev.widgetType])) note(item);
    }
    /* preserveConfigSecrets matches oldCfg.items by id. Hide an item from it to
       stop its secret being refilled. */
    scopedForWidgets.items = newCfg.items;
    const newWidgets = firstById(newCfg.items, n => n.type === 'widget');
    const oldForWidgets = {
      ...oldCfg,
      items: savedItems.flatMap(o => {
        const match = o ? newWidgets.get(o.id) : undefined;
        if (!match || !keepWidget.has(match)) return redirected ? [] : [o];
        const keep = keepWidget.get(match);
        return keep ? [keep] : [];
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
        if (
          (item.skipTlsVerify === true) === (prev.skipTlsVerify === true) &&
          badgeRequestMatchesSaved(asRequest(block), oldBlock ? asRequest(oldBlock) : null)
        )
          continue;
        set(undefined);
        if (blockHoldsSecret(oldBlock) && wantsStoredSecret(block)) note(item);
      }
      preserveItemBadgeSecrets(item, scoped);
    }
  }
  return { withheld };
}

module.exports = { scrubAllSecrets, preserveAllSecrets };
