/* Null prototype: metric names come from the upstream body, and the name
   pattern below admits "__proto__", which on an ordinary object literal takes
   the assignment as a prototype write and silently discards the sample. */
function parsePrometheus(text) {
  const out = Object.create(null);
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const m = t.match(/^([a-zA-Z_:][a-zA-Z0-9_:{}=",./ -]*?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
    if (m) { const v = parseFloat(m[2]); if (!Number.isNaN(v)) out[m[1].trim()] = v; }
  }
  return out;
}

module.exports = { parsePrometheus };
