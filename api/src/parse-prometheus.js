/* Null prototype: metric names come from the upstream body, and the name
   pattern below admits "__proto__", which on an ordinary object literal takes
   the assignment as a prototype write and silently discards the sample.

   Non-string input yields an empty object rather than throwing, matching
   parseXml. Both are handed upstream response bodies, and both are toolbox
   methods a widget's data.js can call directly, so they should fail the same
   way. This one used to call text.split straight away, so passing it an
   already-parsed JSON body threw a TypeError out of the data function and
   became a 502, where the same mistake with XML quietly returned {}.

   Deliberately not capped, unlike parseXml. That cap exists because XML nesting
   amplifies memory well beyond the body's size and because a partial parse is
   still returned, so the caller has to be told. This format is line-oriented and
   linear: measured at the largest body the fetch layer will accept, 4 MB gives
   about 98,000 entries retaining about 4 MB, roughly 1:1. Anything larger is
   rejected outright by FETCH_SIZE_LIMIT rather than truncated, so there is no
   partial read to signal. A cap here would only drop series from a legitimately
   large exporter. */
function parsePrometheus(text) {
  const out = Object.create(null);
  if (typeof text !== 'string') return out;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const m = t.match(/^([a-zA-Z_:][a-zA-Z0-9_:{}=",./ -]*?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
    if (m) { const v = parseFloat(m[2]); if (!Number.isNaN(v)) out[m[1].trim()] = v; }
  }
  return out;
}

module.exports = { parsePrometheus };
