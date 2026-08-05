/* Deep-copy a value onto ordinary prototypes.

   The modules under test build their objects with Object.create(null), because
   their keys come from widget manifests, stored config and i18n catalogs.
   deepStrictEqual compares prototypes, so a null-prototype result never equals
   an object literal however identical its contents. Comparing through this
   keeps expectations written as plain literals while still checking keys and
   values strictly. */
export function plain(v) {
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') {
    const out = {};
    /* defineProperty, not assignment: a key called "__proto__" is one of the
       things these objects exist to hold, and copying it with `out[k] =` would
       set the copy's prototype and lose it. */
    for (const k of Object.keys(v)) {
      Object.defineProperty(out, k, { value: plain(v[k]), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return v;
}
