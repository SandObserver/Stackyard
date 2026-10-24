/* Restore a stored secret only when every field that can redirect it matches
   what is saved. The request chooses the destination, so matching on the item
   id alone sends a stored credential anywhere the caller names. Fields the
   manifest marks cosmetic or transient are excluded. */

const { SAVED_ROW, secretSpec, cosmeticSpec, transientSpec } = require('./widget-secrets');
const { toRows, loginOf } = require('./badge-headers');
const { withManifestDefaults } = require('./widget-defaults');

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
  for (const gk of Object.keys(secretSpec(entry).groups)) {
    if (Array.isArray(out[gk])) for (const row of out[gk]) if (row && typeof row === 'object') delete row[SAVED_ROW];
  }
  return out;
}

/* A row naming a saved row by SAVED_ROW gets that one, or none when the value is
   not an index. Without it, a row matches by id, then by position. */
function savedRowFor(row, i, oldRows) {
  if (row && typeof row === 'object' && Object.hasOwn(row, SAVED_ROW)) {
    const n = row[SAVED_ROW];
    return Number.isInteger(n) && n >= 0 ? oldRows[n] : undefined;
  }
  return row && row.id != null ? oldRows.find(r => r && r.id === row.id) : oldRows[i];
}

/** The saved config with each secret-holding group lined up row for row with
    the posted one, for preserveWidgetSecrets. A row gets its saved row only when
    every field that can redirect the secret matches. Null when a field outside
    those groups differs. `dropped` is true when a row left blank a stored secret
    it does not get back.
    @returns {{ config: Record<string, any>, dropped: boolean } | null} */
function alignSavedConfig(newConfig, savedConfig, entry) {
  if (!entry) return null;
  const cfg = newConfig || {};
  const saved = savedConfig || {};
  const groups = secretSpec(entry).groups;
  const shared = c => {
    const out = { ...c };
    for (const gk of Object.keys(groups)) delete out[gk];
    return out;
  };
  if (!widgetConfigMatchesSaved(shared(cfg), shared(saved), entry)) return null;
  const config = { ...saved };
  let dropped = false;
  for (const [gk, subKeys] of Object.entries(groups)) {
    if (!Array.isArray(cfg[gk])) continue;
    const oldRows = Array.isArray(saved[gk]) ? saved[gk] : [];
    config[gk] = cfg[gk].map((row, i) => {
      const old = savedRowFor(row, i, oldRows);
      if (!old) return {};
      if (widgetConfigMatchesSaved({ [gk]: [row] }, { [gk]: [old] }, entry)) return old;
      if (subKeys.some(k => blankStored(row, old, k))) dropped = true;
      return {};
    });
  }
  return { config, dropped };
}

function widgetConfigMatchesSaved(newConfig, savedConfig, entry) {
  if (!entry) return false;
  const stripped = c => stripWidgetSecrets(withManifestDefaults(c, entry), entry);
  return stableEqual(stripped(newConfig), stripped(savedConfig));
}

const blankStored = (obj, old, k) => !!old && old[k] != null && old[k] !== '' && !(obj && obj[k]);

/** Whether the config leaves blank a secret the saved config holds. */
function leavesStoredSecretBlank(config, savedConfig, entry) {
  const cfg = config || {};
  const saved = savedConfig || {};
  const { topLevel, groups, objects } = secretSpec(entry);
  if (topLevel.some(k => blankStored(cfg, saved, k))) return true;
  for (const [gk, subKeys] of Object.entries(groups)) {
    if (!Array.isArray(cfg[gk])) continue;
    const oldRows = Array.isArray(saved[gk]) ? saved[gk] : [];
    const hit = cfg[gk].some((row, i) => subKeys.some(k => blankStored(row, savedRowFor(row, i, oldRows), k)));
    if (hit) return true;
  }
  return Object.entries(objects).some(([ok, subKeys]) => subKeys.some(k => blankStored(cfg[ok], saved[ok], k)));
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
  if ((loginOf(request.login)?.username || '') !== (loginOf(stored.login)?.username || '')) return false;
  return rowsMatch(request.headers, stored.headers) && rowsMatch(request.params, stored.params);
}

/** Whether a save changes where outbound requests are rewritten to. A rewrite
    moves every stored credential to the mapped host.
    @param {any} next @param {any} prev @returns {boolean} */
function rewriteChanged(next, prev) {
  const map = s => (s && s.portMap && typeof s.portMap === 'object' ? s.portMap : {});
  if (!Object.keys(map(next)).length && !Object.keys(map(prev)).length) return false;
  return !stableEqual(map(next), map(prev)) || (next?.hostIp || '') !== (prev?.hostIp || '');
}

/** Whether a save turns the global certificate skip on or off. Widget requests
    fall back to it. @param {any} next @param {any} prev @returns {boolean} */
function widgetTlsChanged(next, prev) {
  return (next?.skipTlsVerify === true) !== (prev?.skipTlsVerify === true);
}

const RETYPE_MESSAGE =
  'This configuration has changed since it was saved, so the stored credential was not used. ' +
  'Enter the credential to test these settings.';

module.exports = {
  stableEqual,
  stripWidgetSecrets,
  widgetConfigMatchesSaved,
  alignSavedConfig,
  leavesStoredSecretBlank,
  rowsMatch,
  badgeRequestMatchesSaved,
  rewriteChanged,
  widgetTlsChanged,
  RETYPE_MESSAGE,
};
