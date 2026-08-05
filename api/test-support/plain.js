/* Deep-copy a value onto ordinary prototypes.

   The parsers, the widget registry and the lookup maps build their objects with
   Object.create(null), because their keys come from upstream bodies and stored
   config. deepStrictEqual compares prototypes, so a null-prototype result never
   equals an object literal however identical its contents. Comparing through
   this keeps expectations written as plain literals while still checking keys
   and values strictly.

   Deliberately not in api/test: `node --test` collects every .js file under a
   directory named "test" and would report this one as a file with no tests. */
function plain(v) {
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') {
    const out = {};
    /* defineProperty, not assignment: a key called "__proto__" is exactly what
       these objects exist to hold, and copying it with `out[k] =` would set the
       copy's prototype and lose it, reintroducing the bug inside the check. */
    for (const k of Object.keys(v)) {
      Object.defineProperty(out, k, { value: plain(v[k]), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return v;
}

module.exports = { plain };
