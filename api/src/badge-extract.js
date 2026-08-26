function collectNumbers(obj, path = '', out = [], _depth = 0, _state = { n: 0 }) {
  const MAX_DEPTH = 6,
    MAX_NODES = 256;
  if (_state.n++ > MAX_NODES || _depth > MAX_DEPTH || obj == null) return out;
  if (typeof obj === 'number') {
    out.push({ path: path || '(root)', value: obj });
    return out;
  }
  if (Array.isArray(obj)) {
    const countPath = path ? `${path}.$count` : '$count';
    out.push({ path: countPath, value: obj.length, label: `${path || 'root'} (count)` });
    const sample = obj.find(i => i && typeof i === 'object' && !Array.isArray(i));
    if (sample) {
      const seen = Object.create(null);
      for (const [field, val] of Object.entries(sample)) {
        if (_state.n > MAX_NODES) break;
        if (typeof val === 'boolean') {
          for (const bval of [true, false]) {
            const n = obj.filter(i => i && i[field] === bval).length;
            if (n > 0) {
              const p = `${path ? path + '.' : ''}filter(${field}==${bval}).count`;
              if (!seen[p]) {
                seen[p] = 1;
                out.push({ path: p, value: n, label: `${field} == ${bval}` });
              }
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
  let buf = '',
    depth = 0;
  for (const ch of dotPath) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === '.' && depth === 0) {
      if (buf) segments.push(buf);
      buf = '';
    } else buf += ch;
  }
  if (buf) segments.push(buf);

  const filterRe = /^filter\((\w+)==(true|false|[^)]+)\)$/;
  let cur = obj;
  for (const seg of segments) {
    if (cur == null) return undefined;
    if (seg === '$count') return Array.isArray(cur) ? cur.length : undefined;
    /* `count` is the array-length token only on an array. On an object it is
       the field of that name. */
    if (seg === 'count' && Array.isArray(cur)) return cur.length;
    const fM = seg.match(filterRe);
    if (fM) {
      const [, field, rawVal] = fM;
      const val = rawVal === 'true' ? true : rawVal === 'false' ? false : rawVal;
      cur = Array.isArray(cur) ? cur.filter(item => item && item[field] === val) : undefined;
      continue;
    }
    const bare = seg.match(/^\[(\d+)\]$/);
    if (bare) {
      cur = Array.isArray(cur) ? cur[+bare[1]] : undefined;
      continue;
    }
    const named = seg.match(/^(\w+)\[(\d+)\]$/);
    if (named) {
      cur = Array.isArray(cur[named[1]]) ? cur[named[1]][+named[2]] : undefined;
      continue;
    }
    cur = cur[seg];
  }
  return cur;
}

/** Positional: index n is the value for `labels[n]`. A label that resolves to
    no number reads as 0 and keeps its slot.
    @param {any} data @param {any} labels @returns {number[]} */
function computeLabelValues(data, labels) {
  if (!Array.isArray(labels)) return [];
  return labels.map(l => {
    const path = typeof l === 'string' ? l : l?.path;
    if (typeof path !== 'string' || !path) return 0;
    const v = extractPath(data, path);
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  });
}

/** The first label reaching its threshold, or -1.
    @param {any} labels @param {number[]} values @returns {number} */
function firstFiringLabel(labels, values) {
  if (!Array.isArray(labels)) return -1;
  for (let i = 0; i < labels.length; i++) {
    const min = Math.floor(Number(labels[i]?.min));
    if (values[i] >= (Number.isFinite(min) && min > 1 ? min : 1)) return i;
  }
  return -1;
}

function computeBadgeValue(data, badge) {
  if (!badge?.extract) return 0;
  const paths = Array.isArray(badge.extract)
    ? badge.extract.map(e => (typeof e === 'string' ? e : e.path))
    : [typeof badge.extract === 'string' ? badge.extract : badge.extract.path];
  return paths.reduce((s, p) => {
    const v = extractPath(data, p);
    return s + (typeof v === 'number' ? v : 0);
  }, 0);
}

module.exports = { collectNumbers, extractPath, computeBadgeValue, computeLabelValues, firstFiringLabel };
