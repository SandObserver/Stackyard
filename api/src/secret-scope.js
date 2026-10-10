/* Restore a stored secret only when every field that can redirect it matches
   what is saved. The request chooses the destination, so matching on the item
   id alone sends a stored credential anywhere the caller names. Fields the
   manifest marks cosmetic or transient are excluded. */

const { secretSpec, cosmeticSpec, transientSpec } = require('./widget-secrets');
const { toRows } = require('./badge-headers');

function stableEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => stableEqual(v, b[i]));
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every(k => stableEqual(a[k], b[k]));
}

function stripWidgetSecrets(config, entry) {
  const out = structuredClone(config || {});
  const drop = (obj, keys) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of keys) {
      delete obj[k];
      delete obj[k + 'Set'];
    }
  };
  for (const spec of [secretSpec(entry), cosmeticSpec(entry), transientSpec(entry)]) {
    drop(out, spec.topLevel);
    for (const [gk, subKeys] of Object.entries(spec.groups)) {
      if (Array.isArray(out[gk])) for (const row of out[gk]) drop(row, subKeys);
    }
    for (const [ok, subKeys] of Object.entries(spec.objects)) drop(out[ok], subKeys);
  }
  return out;
}

function widgetConfigMatchesSaved(newConfig, savedConfig, entry) {
  if (!entry) return false;
  return stableEqual(stripWidgetSecrets(newConfig, entry), stripWidgetSecrets(savedConfig, entry));
}

/** Whether the config leaves blank a secret the saved config holds. */
function leavesStoredSecretBlank(config, savedConfig, entry) {
  const cfg = config || {};
  const saved = savedConfig || {};
  const blank = (obj, old, k) => !!old && old[k] != null && old[k] !== '' && !(obj && obj[k]);
  const { topLevel, groups, objects } = secretSpec(entry);
  if (topLevel.some(k => blank(cfg, saved, k))) return true;
  for (const [gk, subKeys] of Object.entries(groups)) {
    if (!Array.isArray(cfg[gk])) continue;
    const oldRows = Array.isArray(saved[gk]) ? saved[gk] : [];
    const hit = cfg[gk].some((row, i) => {
      const old = row && row.id != null ? oldRows.find(r => r && r.id === row.id) : oldRows[i];
      return subKeys.some(k => blank(row, old, k));
    });
    if (hit) return true;
  }
  return Object.entries(objects).some(([ok, subKeys]) => subKeys.some(k => blank(cfg[ok], saved[ok], k)));
}

function rowsMatch(newRows, oldRows) {
  const n = toRows(newRows);
  const o = toRows(oldRows);
  if (n.length !== o.length) return false;
  return n.every((row, i) => {
    const old = o[i];
    if ((row.key || '') !== (old.key || '')) return false;
    if (!!row.secret !== !!old.secret) return false;
    if (row.secret) return true;
    return (row.value == null ? '' : row.value) === (old.value == null ? '' : old.value);
  });
}

function badgeRequestMatchesSaved(request, stored) {
  if (!stored) return false;
  if ((request.url || '') !== (stored.url || '')) return false;
  return rowsMatch(request.headers, stored.headers) && rowsMatch(request.params, stored.params);
}

/** Whether a save changes where outbound requests are rewritten to. A rewrite
    moves every stored credential to the mapped host.
    @param {any} next @param {any} prev @returns {boolean} */
function rewriteChanged(next, prev) {
  const map = s => (s && s.portMap && typeof s.portMap === 'object' ? s.portMap : {});
  if (!Object.keys(map(next)).length) return false;
  return !stableEqual(map(next), map(prev)) || (next?.hostIp || '') !== (prev?.hostIp || '');
}

const RETYPE_MESSAGE =
  'This configuration has changed since it was saved, so the stored credential was not used. ' +
  'Enter the credential to test these settings.';

module.exports = {
  stableEqual,
  stripWidgetSecrets,
  widgetConfigMatchesSaved,
  leavesStoredSecretBlank,
  rowsMatch,
  badgeRequestMatchesSaved,
  rewriteChanged,
  RETYPE_MESSAGE,
};
