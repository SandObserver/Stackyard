function parsePrometheus(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const m = t.match(/^([a-zA-Z_:][a-zA-Z0-9_:{}=",./ -]*?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
    if (m) { const v = parseFloat(m[2]); if (!Number.isNaN(v)) out[m[1].trim()] = v; }
  }
  return out;
}

module.exports = { parsePrometheus };
