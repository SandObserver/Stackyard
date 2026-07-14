const { getRegistry } = require('./widgets');

/* Collect the secret field keys a widget declares, from its manifest fields.
   Returns top-level secret keys and, for each repeatable group, the secret keys
   that appear inside one row of that group. Groups are not nested (the manifest
   validator forbids it), so one level is sufficient. */
function secretSpec(entry) {
  const fields = (entry && entry.manifest && entry.manifest.fields) || [];
  const topLevel = [];
  const groups = {};
  const objects = {};
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

/* Strip declared secrets from one widget item, replacing each with a
   "<key>Set": true flag so the UI can show that a value is stored. Mutates the
   item, so callers must pass a copy (the read paths already deep-copy config
   before sending it to the browser). Items whose type is not a folder-style
   widget are left untouched, legacy widgets stay on their existing handling. */
function scrubWidgetSecrets(item, entry) {
  const e = _entryFor(item, entry);
  if (!e || !item || !item.widgetConfig) return;
  const wc = item.widgetConfig;
  const { topLevel, groups, objects } = secretSpec(e);

  for (const k of topLevel) {
    if (k in wc) { wc[k + 'Set'] = true; delete wc[k]; }
  }
  for (const [gk, subKeys] of Object.entries(groups)) {
    if (!Array.isArray(wc[gk])) continue;
    wc[gk] = wc[gk].map(row => {
      if (!row || typeof row !== 'object') return row;
      const out = { ...row };
      for (const sk of subKeys) if (sk in out) { out[sk + 'Set'] = true; delete out[sk]; }
      return out;
    });
  }
  for (const [ok, subKeys] of Object.entries(objects)) {
    const obj = wc[ok];
    if (!obj || typeof obj !== 'object') continue;
    for (const sk of subKeys) if (sk in obj) { obj[sk + 'Set'] = true; delete obj[sk]; }
  }
}

/* On save, restore any declared secret the browser omitted from the previously
   stored value, and keep the "<key>Set" flag in sync. Group rows are matched by
   position. Mutates newItem.widgetConfig. Non-folder widgets are left untouched. */
function preserveWidgetSecrets(newItem, oldItem, entry) {
  const e = _entryFor(newItem, entry);
  if (!e || !newItem || !newItem.widgetConfig) return;
  const nwc = newItem.widgetConfig;
  const owc = (oldItem && oldItem.widgetConfig) || {};
  const { topLevel, groups, objects } = secretSpec(e);

  for (const k of topLevel) {
    if (!(k in nwc) && owc[k] != null) nwc[k] = owc[k];
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
        if (!(sk in row) && oldRow[sk] != null) row[sk] = oldRow[sk];
        if (row[sk] != null) row[sk + 'Set'] = true;
      }
    });
  }
  for (const [ok, subKeys] of Object.entries(objects)) {
    const nObj = nwc[ok];
    if (!nObj || typeof nObj !== 'object') continue;
    const oObj = (owc[ok] && typeof owc[ok] === 'object') ? owc[ok] : {};
    for (const sk of subKeys) {
      if (!(sk in nObj) && oObj[sk] != null) nObj[sk] = oObj[sk];
      if (nObj[sk] != null) nObj[sk + 'Set'] = true;
    }
  }
}

/* Config-level convenience wrappers for the routes that handle the whole config.
   Each only acts on folder-style widgets (those present in the registry), so it
   is a no-op while no widgets have been converted, and never disturbs legacy
   widgets handled by the existing hand-written logic. */
function scrubConfigSecrets(cfgCopy) {
  const reg = getRegistry();
  if (Array.isArray(cfgCopy.items)) {
    for (const item of cfgCopy.items) {
      if (item && item.type === 'widget' && reg[item.widgetType]) scrubWidgetSecrets(item, reg[item.widgetType]);
    }
  }
  return cfgCopy;
}

function preserveConfigSecrets(newCfg, oldCfg) {
  const reg = getRegistry();
  if (Array.isArray(newCfg.items) && Array.isArray(oldCfg && oldCfg.items)) {
    for (const item of newCfg.items) {
      if (!item || item.type !== 'widget' || !reg[item.widgetType]) continue;
      const prev = oldCfg.items.find(e => e && e.id === item.id);
      preserveWidgetSecrets(item, prev, reg[item.widgetType]);
    }
  }
  return newCfg;
}

module.exports = {
  secretSpec,
  scrubWidgetSecrets, preserveWidgetSecrets,
  scrubConfigSecrets, preserveConfigSecrets,
};
