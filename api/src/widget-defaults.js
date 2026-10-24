/* The secret check and the data function must both read a config through this.
   If only one does, a stored secret can be restored for one destination and
   sent to another. */

function defaultsOf(fields) {
  const seen = new Map();
  for (const f of Array.isArray(fields) ? fields : []) {
    if (!f || typeof f.key !== 'string' || !f.key) continue;
    const usable = f.default !== undefined && f.cosmetic !== true && f.transient !== true && f.type !== 'secret';
    const value = usable ? JSON.stringify(f.default) : null;
    const prev = seen.get(f.key);
    seen.set(f.key, prev === undefined || prev === value ? value : null);
  }
  const out = new Map();
  for (const [k, v] of seen) if (v !== null) out.set(k, v);
  return out;
}

function fill(obj, defaults) {
  let out = obj;
  for (const [k, v] of defaults) {
    if (Object.hasOwn(obj, k) && obj[k] !== undefined) continue;
    if (out === obj) out = { ...obj };
    out[k] = JSON.parse(v);
  }
  return out;
}

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

function withManifestDefaults(config, entry) {
  const fields = (entry && entry.manifest && entry.manifest.fields) || [];
  let out = fill(isObj(config) ? config : {}, defaultsOf(fields));
  const nested = new Map();
  for (const f of fields) {
    if (!f || typeof f.key !== 'string' || !Array.isArray(f.fields)) continue;
    if (f.type !== 'group' && f.type !== 'object') continue;
    const prev = nested.get(f.key);
    nested.set(f.key, { type: f.type, fields: (prev ? prev.fields : []).concat(f.fields) });
  }
  for (const [k, { type, fields: sub }] of nested) {
    const defaults = defaultsOf(sub);
    if (!defaults.size) continue;
    const v = out[k];
    let next = v;
    if (type === 'group' && Array.isArray(v)) {
      const rows = v.map(row => (isObj(row) ? fill(row, defaults) : row));
      if (rows.some((row, i) => row !== v[i])) next = rows;
    } else if (type === 'object' && isObj(v)) next = fill(v, defaults);
    if (next !== v) {
      if (out === config) out = { ...out };
      out[k] = next;
    }
  }
  return out;
}

module.exports = { withManifestDefaults };
