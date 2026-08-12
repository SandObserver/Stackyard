/* Restore a stored secret only when every non-secret field matches what is
   saved. The request chooses the destination, so matching on the item id alone
   sends a stored credential anywhere the caller names. */

const { secretSpec } = require('./widget-secrets');
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
  const { topLevel, groups, objects } = secretSpec(entry);
  const out = JSON.parse(JSON.stringify(config || {}));
  const drop = (obj, keys) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of keys) {
      delete obj[k];
      delete obj[k + 'Set'];
    }
  };
  drop(out, topLevel);
  for (const [gk, subKeys] of Object.entries(groups)) {
    if (Array.isArray(out[gk])) for (const row of out[gk]) drop(row, subKeys);
  }
  for (const [ok, subKeys] of Object.entries(objects)) drop(out[ok], subKeys);
  return out;
}

function widgetConfigMatchesSaved(newConfig, savedConfig, entry) {
  if (!entry) return false;
  return stableEqual(stripWidgetSecrets(newConfig, entry), stripWidgetSecrets(savedConfig, entry));
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

const RETYPE_MESSAGE =
  'This configuration has changed since it was saved, so the stored credential was not used. ' +
  'Enter the credential to test these settings.';

module.exports = {
  stableEqual,
  stripWidgetSecrets,
  widgetConfigMatchesSaved,
  rowsMatch,
  badgeRequestMatchesSaved,
  RETYPE_MESSAGE,
};
