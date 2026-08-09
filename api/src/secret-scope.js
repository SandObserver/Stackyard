/* When a stored secret may be attached to a request the caller composed.

   Two endpoints let the browser post an in-progress config and have the server
   fill in a credential, and both let the request choose the destination, so
   matching on the item id alone would send a stored credential anywhere the
   caller names. Restore only when every non-secret field is identical to what
   is saved. */

const { secretSpec } = require('./widget-secrets');
const { toRows } = require('./badge-headers');

/* Order-insensitive: key order differs between what the browser sends and what
   was parsed from disk, so JSON.stringify would report a difference that is not
   one. */
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

/* A copy of a widget config with every declared secret, and its Set flag,
   removed at all three levels the manifest allows. */
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

/* True when the posted widget config differs from the saved one only in its
   secrets, so the saved secrets still belong to this request. */
function widgetConfigMatchesSaved(newConfig, savedConfig, entry) {
  if (!entry) return false;
  return stableEqual(stripWidgetSecrets(newConfig, entry), stripWidgetSecrets(savedConfig, entry));
}

/* Positional, so a reorder is a change. Secret values are not compared, since
   the browser never receives them; the key and the secret flag are. */
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

/* The message both endpoints return when they decline to restore. Phrased for
   the person editing the form, since that is who sees it. */
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
