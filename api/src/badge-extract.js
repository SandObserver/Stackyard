/* Pure value-extraction logic for activity badges, split out from the badges
   route so it can be unit-tested. All three functions operate on plain parsed
   JSON with no I/O:
     collectNumbers   - walk an arbitrary response and surface numeric paths
                        (plus array counts and boolean filter counts) for the picker
     extractPath      - resolve one dot-path (with filter(...) and [i] segments)
     computeBadgeValue - sum the numbers a badge's extract path(s) resolve to */

function collectNumbers(obj, path = '', out = [], _depth = 0, _state = { n: 0 }) {
  const MAX_DEPTH = 6, MAX_NODES = 256;
  if (_state.n++ > MAX_NODES || _depth > MAX_DEPTH || obj == null) return out;
  if (typeof obj === 'number') { out.push({ path: path || '(root)', value: obj }); return out; }
  if (Array.isArray(obj)) {
    const countPath = path ? `${path}.$count` : '$count';
    out.push({ path: countPath, value: obj.length, label: `${path || 'root'} — count` });
    const sample = obj.find(i => i && typeof i === 'object' && !Array.isArray(i));
    if (sample) {
      const seen = {};
      for (const [field, val] of Object.entries(sample)) {
        if (_state.n > MAX_NODES) break;
        if (typeof val === 'boolean') {
          for (const bval of [true, false]) {
            const n = obj.filter(i => i && i[field] === bval).length;
            if (n > 0) {
              const p = `${path ? path + '.' : ''}filter(${field}==${bval}).count`;
              if (!seen[p]) { seen[p] = 1; out.push({ path: p, value: n, label: `${field} == ${bval}` }); }
            }
          }
        }
      }
    }
    obj.slice(0, 3).forEach((v, i) => collectNumbers(v, path ? `${path}[${i}]` : `[${i}]`, out, _depth + 1, _state));
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (_state.n > MAX_NODES) break;
      collectNumbers(v, path ? `${path}.${k}` : k, out, _depth + 1, _state);
    }
  }
  return out;
}

function extractPath(obj, dotPath) {
  const segments = [];
  let buf = '', depth = 0;
  for (const ch of dotPath) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === '.' && depth === 0) { if (buf) segments.push(buf); buf = ''; }
    else buf += ch;
  }
  if (buf) segments.push(buf);

  const filterRe = /^filter\((\w+)==(true|false|[^)]+)\)$/;
  let cur = obj;
  for (const seg of segments) {
    if (cur == null) return undefined;
    if (seg === '$count' || seg === 'count') return Array.isArray(cur) ? cur.length : undefined;
    const fM = seg.match(filterRe);
    if (fM) {
      const [, field, rawVal] = fM;
      const val = rawVal === 'true' ? true : rawVal === 'false' ? false : rawVal;
      cur = Array.isArray(cur) ? cur.filter(item => item && item[field] === val) : undefined;
      continue;
    }
    const bare = seg.match(/^\[(\d+)\]$/);
    if (bare) { cur = Array.isArray(cur) ? cur[+bare[1]] : undefined; continue; }
    const named = seg.match(/^(\w+)\[(\d+)\]$/);
    if (named) { cur = Array.isArray(cur[named[1]]) ? cur[named[1]][+named[2]] : undefined; continue; }
    cur = cur[seg];
  }
  return cur;
}

function computeBadgeValue(data, badge) {
  if (!badge?.extract) return 0;
  const paths = Array.isArray(badge.extract)
    ? badge.extract.map(e => typeof e === 'string' ? e : e.path)
    : [typeof badge.extract === 'string' ? badge.extract : badge.extract.path];
  return paths.reduce((s, p) => { const v = extractPath(data, p); return s + (typeof v === 'number' ? v : 0); }, 0);
}

module.exports = { collectNumbers, extractPath, computeBadgeValue };
