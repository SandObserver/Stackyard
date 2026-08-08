/* The slice of global settings a widget's data function may see. An allowlist,
   not a denylist: settings holds the session signing key and the password hash,
   and a denylist leaks the first secret someone forgets to add.

   To share a new setting, add its top-level key here and document it in
   docs/widgets.md. Non-secret values only. */
const SHARED_KEYS = ['stats'];

/* Recursively freeze, so a data function cannot reach a nested object and
   change what a later widget in the same request cycle reads. */
function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

/* Copied as well as frozen: freezing the live object would stop the server
   writing its own config. */
function widgetSettings(settings) {
  const out = Object.create(null);
  if (settings && typeof settings === 'object') {
    for (const k of SHARED_KEYS) {
      if (!Object.hasOwn(settings, k)) continue;
      out[k] = structuredClone(settings[k]);
    }
  }
  return deepFreeze(out);
}

module.exports = { widgetSettings, SHARED_KEYS };
