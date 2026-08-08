/* Null prototype: metric names come from the upstream body, and the name pattern
   admits "__proto__", which would be taken as a prototype write.

   Non-string input yields {} rather than throwing, matching parseXml, since both
   are toolbox methods a widget's data.js can call directly.

   Deliberately uncapped, unlike parseXml: this format is linear rather than
   nesting, and FETCH_SIZE_LIMIT already bounds the body. */
function parsePrometheus(text) {
  const out = Object.create(null);
  if (typeof text !== 'string') return out;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const m = t.match(/^([a-zA-Z_:][a-zA-Z0-9_:{}=",./ -]*?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
    if (m) {
      const v = parseFloat(m[2]);
      if (!Number.isNaN(v)) out[m[1].trim()] = v;
    }
  }
  return out;
}

module.exports = { parsePrometheus };
