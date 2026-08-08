const { getRegistry } = require('./widgets');

/* The secret field keys a widget declares, top level and one row deep, which is
   enough because the validator forbids nested groups. Membership is tested with
   Object.hasOwn, since config from disk inherits "constructor" and the rest. */
function secretSpec(entry) {
  const fields = (entry && entry.manifest && entry.manifest.fields) || [];
  const topLevel = [];
  const groups = Object.create(null);
  const objects = Object.create(null);
  const subSecrets = f => f.fields.filter(sf => sf && sf.type === 'secret' && sf.key).map(sf => sf.key);
  for (const f of fields) {
    if (!f || !f.key) continue;
    if (f.type === 'secret') topLevel.push(f.key);
    else if (f.type === 'group' && Array.isArray(f.fields)) {
      const sub = subSecrets(f);
      if (sub.length) groups[f.key] = sub;
    } else if (f.type === 'object' && Array.isArray(f.fields)) {
      const sub = subSecrets(f);
      if (sub.length) objects[f.key] = sub;
    }
  }
  return { topLevel, groups, objects };
}

function _entryFor(item, entry) {
  return entry || getRegistry()[item && item.widgetType];
}

/* Replaces each secret with a "<key>Set" flag. Mutates the item, so callers must
   pass a copy. */
function scrubWidgetSecrets(item, entry) {
  const e = _entryFor(item, entry);
  if (!e || !item || !item.widgetConfig) return;
  const wc = item.widgetConfig;
  const { topLevel, groups, objects } = secretSpec(e);

  for (const k of topLevel) {
    if (Object.hasOwn(wc, k)) {
      wc[k + 'Set'] = true;
      delete wc[k];
    }
  }
  for (const [gk, subKeys] of Object.entries(groups)) {
    if (!Array.isArray(wc[gk])) continue;
    wc[gk] = wc[gk].map(row => {
      if (!row || typeof row !== 'object') return row;
      const out = { ...row };
      for (const sk of subKeys)
        if (Object.hasOwn(out, sk)) {
          out[sk + 'Set'] = true;
          delete out[sk];
        }
      return out;
    });
  }
  for (const [ok, subKeys] of Object.entries(objects)) {
    const obj = wc[ok];
    if (!obj || typeof obj !== 'object') continue;
    for (const sk of subKeys)
      if (Object.hasOwn(obj, sk)) {
        obj[sk + 'Set'] = true;
        delete obj[sk];
      }
  }
}

/* Group rows are matched by position. Mutates newItem.widgetConfig. */
function preserveWidgetSecrets(newItem, oldItem, entry) {
  const e = _entryFor(newItem, entry);
  if (!e || !newItem || !newItem.widgetConfig) return;
  const nwc = newItem.widgetConfig;
  const owc = (oldItem && oldItem.widgetConfig) || {};
  const { topLevel, groups, objects } = secretSpec(e);

  for (const k of topLevel) {
    if (!Object.hasOwn(nwc, k) && owc[k] != null) nwc[k] = owc[k];
    if (nwc[k] != null) nwc[k + 'Set'] = true;
  }
  for (const [gk, subKeys] of Object.entries(groups)) {
    if (!Array.isArray(nwc[gk])) continue;
    const oldRows = Array.isArray(owc[gk]) ? owc[gk] : [];
    nwc[gk].forEach((row, i) => {
      if (!row || typeof row !== 'object') return;
      /* Match the previous row by id when the row carries one (so reordering or
         deleting rows can't misassign a stored secret); fall back to position. */
      const oldRow = (row.id != null ? oldRows.find(r => r && r.id === row.id) : oldRows[i]) || {};
      for (const sk of subKeys) {
        if (!Object.hasOwn(row, sk) && oldRow[sk] != null) row[sk] = oldRow[sk];
        if (row[sk] != null) row[sk + 'Set'] = true;
      }
    });
  }
  for (const [ok, subKeys] of Object.entries(objects)) {
    const nObj = nwc[ok];
    if (!nObj || typeof nObj !== 'object') continue;
    const oObj = owc[ok] && typeof owc[ok] === 'object' ? owc[ok] : {};
    for (const sk of subKeys) {
      if (!Object.hasOwn(nObj, sk) && oObj[sk] != null) nObj[sk] = oObj[sk];
      if (nObj[sk] != null) nObj[sk + 'Set'] = true;
    }
  }
}

/* The manifest is what says which fields are secret, so a widget without one has
   its whole config withheld: not recognised means withhold. A wrong WIDGETS_PATH
   makes every widget unknown at once.

   Safe only because preserveConfigSecrets puts the stored config back on save.
   Changing one without the other trades a leak for data loss. */
const WITHHELD_FLAG = 'widgetConfigWithheld';

function withholdWidgetConfig(item) {
  item.widgetConfig = {};
  item[WITHHELD_FLAG] = true;
}

/* The browser was given nothing, so whatever it returns is discarded in favour of
   what is stored. A widget with no stored counterpart is new. */
function restoreWithheldConfig(newItem, oldItem) {
  delete newItem[WITHHELD_FLAG];
  if (oldItem && oldItem.widgetConfig) {
    newItem.widgetConfig = JSON.parse(JSON.stringify(oldItem.widgetConfig));
  }
}

/* Whole-config wrappers. Each acts only on widgets present in the registry. */
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
      /* A transport flag, never persisted: a manifest that loads again between
         the read and the save would otherwise carry it into stored config. */
      delete item[WITHHELD_FLAG];
      if (entry) preserveWidgetSecrets(item, prev, entry);
      else restoreWithheldConfig(item, prev);
    }
  }
  return newCfg;
}

module.exports = {
  secretSpec,
  WITHHELD_FLAG,
  withholdWidgetConfig,
  restoreWithheldConfig,
  scrubWidgetSecrets,
  preserveWidgetSecrets,
  scrubConfigSecrets,
  preserveConfigSecrets,
};
