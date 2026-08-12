/* The slice of global settings a widget's data function may see. Keep it an
   allowlist. settings holds the session signing key and the password hash. */
const SHARED_KEYS = ['stats'];

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

/* Copy before freezing. Freezing the live object stops the server writing its
   own config. */
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
