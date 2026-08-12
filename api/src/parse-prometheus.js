/* Keep the null prototype. Metric names come from the upstream body and the
   name pattern admits "__proto__". */
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
