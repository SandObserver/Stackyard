/* The slice of global settings a widget's data function may see.

   ctx.settings used to be loadConfig().settings itself: the whole object, by
   reference. That handed every data function the session signing key and the
   password hash (settings.auth), the host IP, port map, TLS-skip flag and
   Docker socket URL (settings.server), and let it mutate any of them for the
   rest of the config cache's lifetime. One key in the entire repository is
   actually read this way, stats.diskMount.

   The list is therefore an allowlist, not a denylist. A denylist would have to
   be updated every time a secret is added under settings, and forgetting once
   leaks it; an allowlist withholds anything nobody has asked for. Same default
   as the widget config scrubber: not recognised means withhold.

   To share a new setting with widgets, add its top-level key here and say so in
   docs/widgets.md. Only put non-secret values in the list. */
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

/* A frozen deep copy of the shared keys present in `settings`. Copied as well as
   frozen: freezing the live object in place would make the rest of the server
   unable to write its own config. */
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
