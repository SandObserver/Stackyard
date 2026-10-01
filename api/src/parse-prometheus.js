const FIRST = /[a-zA-Z_:]/;
const NAME_CHAR = /[a-zA-Z0-9_:{}=",./ -]/;
const SPACE = /\s/;
const VALUE = /[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/y;

/* Keep this a single forward pass. A backtracking regex here is quadratic,
   and one hostile reply blocks the API for hours.

   @param {string} t a trimmed, non-empty line @returns {[string, number] | null} */
function _metricLine(t) {
  if (!FIRST.test(t[0])) return null;
  let i = 1;
  let quoted = false;
  while (i < t.length) {
    const c = t[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') quoted = false;
      i++;
      continue;
    }
    if (c === '"') quoted = true;
    if (!SPACE.test(c)) {
      if (!NAME_CHAR.test(c)) return null;
      i++;
      continue;
    }
    let k = i;
    let onlySpaces = true;
    while (k < t.length && SPACE.test(t[k])) {
      if (t[k] !== ' ') onlySpaces = false;
      k++;
    }
    VALUE.lastIndex = k;
    const m = VALUE.exec(t);
    if (m) return [t.slice(0, i).trim(), parseFloat(m[0])];
    if (!onlySpaces) return null;
    i = k;
  }
  return null;
}

/* Keep the null prototype. Metric names come from the upstream body and the
   name pattern admits "__proto__". */
function parsePrometheus(text) {
  const out = Object.create(null);
  if (typeof text !== 'string') return out;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const m = _metricLine(t);
    if (m && !Number.isNaN(m[1])) out[m[0]] = m[1];
  }
  return out;
}

module.exports = { parsePrometheus };
