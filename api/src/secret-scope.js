/* When a stored secret may be attached to a request the caller composed.

   Two endpoints let the browser post an in-progress config and have the server
   fill in a credential it already holds:

     POST /api/widget-options/:id   widget config, secret restored by item id
     POST /api/badge-proxy          badge URL + rows, secrets restored by itemId

   Both let the request supply the destination while the server supplies the
   credential. Restoring on the id alone therefore turns "can edit config" into
   "can read every stored credential": point the URL at a host you control, omit
   the secret, and the server sends the real one there in plaintext.

   The rule below is deliberately blunt: restore only when every non-secret field
   is identical to what is saved. Comparing just the fields that look like a
   destination would be kinder to use and worse to trust, because it needs an
   implicit assumption about which fields matter, which is the assumption that
   failed here in the first place. A mismatch is not an error in itself; it only
   means the caller has to supply the credential with the request.

   Secret values are never compared, since the caller does not have them. The
   "<key>Set" flags are not compared either: they are presence markers the scrub
   path adds, not user data. */

const { secretSpec } = require('./widget-secrets');
const { toRows } = require('./badge-headers');

/* Order-insensitive structural comparison. Object key order varies between what
   the browser sends and what was parsed from disk, so a plain JSON.stringify
   would report a difference that is not one. */
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
    for (const k of keys) { delete obj[k]; delete obj[k + 'Set']; }
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

/* Rows are positional, so a reorder counts as a change. Secret row values are
   not compared, since the browser never receives them; the key and the secret
   flag are, so renaming a header or flipping its Secret box is a change. */
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

/* True when a badge test targets exactly the saved destination with exactly the
   saved non-secret rows. `stored` is the badge or activity block, whichever the
   caller resolved as active. */
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
  stableEqual, stripWidgetSecrets,
  widgetConfigMatchesSaved, rowsMatch, badgeRequestMatchesSaved,
  RETYPE_MESSAGE,
};
