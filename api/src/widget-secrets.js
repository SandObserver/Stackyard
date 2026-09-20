const { getRegistry } = require('./widgets');

/* The matching field keys a widget declares, top level and one row deep. Test
   membership with Object.hasOwn. Config from disk inherits "constructor" and the
   rest of Object.prototype. Keys are deduplicated. A group declares one key per
   provider it serves, and a caller acting per entry would act on it twice. */
function _spec(entry, match) {
  const fields = (entry && entry.manifest && entry.manifest.fields) || [];
  const topLevel = new Set();
  const groups = Object.create(null);
  const objects = Object.create(null);
  const subKeys = f => [...new Set(f.fields.filter(sf => sf && sf.key && match(sf)).map(sf => sf.key))];
  for (const f of fields) {
    if (!f || !f.key) continue;
    if (match(f)) topLevel.add(f.key);
    else if (f.type === 'group' && Array.isArray(f.fields)) {
      const sub = subKeys(f);
      if (sub.length) groups[f.key] = sub;
    } else if (f.type === 'object' && Array.isArray(f.fields)) {
      const sub = subKeys(f);
      if (sub.length) objects[f.key] = sub;
    }
  }
  return { topLevel: [...topLevel], groups, objects };
}

function secretSpec(entry) {
  return _spec(entry, f => f.type === 'secret');
}

/* Fields that cannot change where a request goes. Unmarked is the safe
   default: an unknown field still invalidates a stored secret. */
function cosmeticSpec(entry) {
  return _spec(entry, f => f.cosmetic === true);
}

function _entryFor(item, entry) {
  return entry || getRegistry()[item && item.widgetType];
}

/* Mutates the item. Pass a copy. */
function scrubWidgetSecrets(item, entry) {
  const e = _entryFor(item, entry);
  if (!e || !item || !item.widgetConfig) return;
  const wc = item.widgetConfig;
  const { topLevel, groups, objects } = secretSpec(e);

  /* Set the marker from the secret. An older config can carry a stale one. */
  const mark = (obj, k) => {
    const held = Object.hasOwn(obj, k) && obj[k] != null && obj[k] !== '';
    if (held) obj[k + 'Set'] = true;
    else delete obj[k + 'Set'];
    delete obj[k];
  };

  for (const k of topLevel) mark(wc, k);
  for (const [gk, subKeys] of Object.entries(groups)) {
    if (!Array.isArray(wc[gk])) continue;
    wc[gk] = wc[gk].map(row => {
      if (!row || typeof row !== 'object') return row;
      const out = { ...row };
      for (const sk of subKeys) mark(out, sk);
      return out;
    });
  }
  for (const [ok, subKeys] of Object.entries(objects)) {
    const obj = wc[ok];
    if (!obj || typeof obj !== 'object') continue;
    for (const sk of subKeys) mark(obj, sk);
  }
}

/* Mutates newItem.widgetConfig. Never store a "<key>Set" marker. A stored
   marker outlives the secret it describes and can be asserted by the caller. */
function preserveWidgetSecrets(newItem, oldItem, entry) {
  const e = _entryFor(newItem, entry);
  if (!e || !newItem || !newItem.widgetConfig) return;
  const nwc = newItem.widgetConfig;
  const owc = (oldItem && oldItem.widgetConfig) || {};
  const { topLevel, groups, objects } = secretSpec(e);

  for (const k of topLevel) {
    if (!Object.hasOwn(nwc, k) && owc[k] != null) nwc[k] = owc[k];
    delete nwc[k + 'Set'];
  }
  for (const [gk, subKeys] of Object.entries(groups)) {
    if (!Array.isArray(nwc[gk])) continue;
    const oldRows = Array.isArray(owc[gk]) ? owc[gk] : [];
    nwc[gk].forEach((row, i) => {
      if (!row || typeof row !== 'object') return;
      /* Match by id first. Position alone misassigns a stored secret after a
         reorder or a delete. */
      const oldRow = (row.id != null ? oldRows.find(r => r && r.id === row.id) : oldRows[i]) || {};
      for (const sk of subKeys) {
        if (!Object.hasOwn(row, sk) && oldRow[sk] != null) row[sk] = oldRow[sk];
        delete row[sk + 'Set'];
      }
    });
  }
  for (const [ok, subKeys] of Object.entries(objects)) {
    const nObj = nwc[ok];
    if (!nObj || typeof nObj !== 'object') continue;
    const oObj = owc[ok] && typeof owc[ok] === 'object' ? owc[ok] : {};
    for (const sk of subKeys) {
      if (!Object.hasOwn(nObj, sk) && oObj[sk] != null) nObj[sk] = oObj[sk];
      delete nObj[sk + 'Set'];
    }
  }
}

/* A widget with no manifest has its whole config withheld. Safe only because
   preserveConfigSecrets puts the stored config back on save. Changing one
   without the other trades a leak for data loss. */
const WITHHELD_FLAG = 'widgetConfigWithheld';

function withholdWidgetConfig(item) {
  item.widgetConfig = {};
  item[WITHHELD_FLAG] = true;
}

function restoreWithheldConfig(newItem, oldItem) {
  delete newItem[WITHHELD_FLAG];
  if (oldItem && oldItem.widgetConfig) {
    newItem.widgetConfig = structuredClone(oldItem.widgetConfig);
  }
}

function scrubConfigSecrets(cfgCopy) {
  const reg = getRegistry();
  if (Array.isArray(cfgCopy.items)) {
    for (const item of cfgCopy.items) {
      if (!item || item.type !== 'widget') continue;
      const entry = reg[item.widgetType];
      if (entry) scrubWidgetSecrets(item, entry);
      else withholdWidgetConfig(item);
    }
  }
  return cfgCopy;
}

function preserveConfigSecrets(newCfg, oldCfg) {
  const reg = getRegistry();
  if (Array.isArray(newCfg.items)) {
    const oldItems = Array.isArray(oldCfg && oldCfg.items) ? oldCfg.items : [];
    for (const item of newCfg.items) {
      if (!item || item.type !== 'widget') continue;
      const prev = oldItems.find(e => e && e.id === item.id);
      const entry = reg[item.widgetType];
      /* A transport flag. Never persist it. */
      delete item[WITHHELD_FLAG];
      if (entry) preserveWidgetSecrets(item, prev, entry);
      else restoreWithheldConfig(item, prev);
    }
  }
  return newCfg;
}

module.exports = {
  secretSpec,
  cosmeticSpec,
  WITHHELD_FLAG,
  scrubWidgetSecrets,
  preserveWidgetSecrets,
  scrubConfigSecrets,
  preserveConfigSecrets,
};
