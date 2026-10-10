/* A key that reads back unchanged as a bare segment. Anything else is written
   as a quoted segment, or extractPath cannot find it again. */
const BARE_KEY = /^[^.[\]()"]+$/;

const keySeg = (path, k) =>
  BARE_KEY.test(k) && k !== '$count' && k !== '(root)' ? (path ? `${path}.${k}` : k) : `${path}[${JSON.stringify(k)}]`;
const keyLabel = (label, k) => (label ? `${label}.${k}` : k);
const filterSeg = (field, bval) => `filter(${/^\w+$/.test(field) ? field : JSON.stringify(field)}==${bval})`;

function collectNumbers(obj, path = '', out = [], _depth = 0, _state = { n: 0, scanned: 0 }, label = path) {
  const MAX_DEPTH = 6,
    MAX_NODES = 256,
    MAX_SCANNED = 1_000_000;
  if (_state.n++ > MAX_NODES || _depth > MAX_DEPTH || obj == null) return out;
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) return out;
    const p = path || '(root)';
    out.push(label && label !== p ? { path: p, value: obj, label } : { path: p, value: obj });
    return out;
  }
  if (Array.isArray(obj)) {
    const countPath = path ? `${path}.$count` : '$count';
    out.push({ path: countPath, value: obj.length, label: `${label || 'root'} (count)` });
    const sample = obj.find(i => i && typeof i === 'object' && !Array.isArray(i));
    if (sample) {
      for (const [field, val] of Object.entries(sample)) {
        if (typeof val !== 'boolean') continue;
        if (_state.n++ > MAX_NODES || _state.scanned + obj.length > MAX_SCANNED) break;
        _state.scanned += obj.length;
        let yes = 0,
          no = 0;
        for (const i of obj) {
          if (i?.[field] === true) yes++;
          else if (i?.[field] === false) no++;
        }
        for (const bval of [true, false]) {
          const n = bval ? yes : no;
          if (n > 0)
            out.push({
              path: `${path ? path + '.' : ''}${filterSeg(field, bval)}.count`,
              value: n,
              label: `${field} == ${bval}`,
            });
        }
      }
    }
    obj.slice(0, 3).forEach((v, i) => collectNumbers(v, `${path}[${i}]`, out, _depth + 1, _state, `${label}[${i}]`));
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (_state.n > MAX_NODES) break;
      collectNumbers(v, keySeg(path, k), out, _depth + 1, _state, keyLabel(label, k));
    }
  }
  return out;
}

/** A quoted string starting at `at`, as [value, index past it], or null.
    @param {string} s @param {number} at @returns {[string, number]|null} */
function readQuoted(s, at) {
  for (let i = at + 1; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') {
      try {
        return [JSON.parse(s.slice(at, i + 1)), i + 1];
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Path text to segments: { key } for a property, quoted when written as one, { index } for an array
    element, { filter, value } for a filter. Null when the text is malformed.
    @param {string} dotPath */
function parsePath(dotPath) {
  /** @type {Array<{ key?: string, quoted?: boolean, index?: number, filter?: string, value?: unknown }>} */
  const segs = [];
  const s = String(dotPath);
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '.') {
      i++;
      continue;
    }
    if (ch === '[') {
      if (s[i + 1] === '"') {
        const q = readQuoted(s, i + 1);
        if (!q || s[q[1]] !== ']') return null;
        segs.push({ key: q[0], quoted: true });
        i = q[1] + 1;
      } else {
        const m = /^\[(\d+)\]/.exec(s.slice(i));
        if (!m) return null;
        segs.push({ index: Number(m[1]) });
        i += m[0].length;
      }
      continue;
    }
    if (s.startsWith('filter(', i)) {
      let field, j;
      if (s[i + 7] === '"') {
        const q = readQuoted(s, i + 7);
        if (!q) return null;
        [field, j] = q;
      } else {
        const m = /^\w+/.exec(s.slice(i + 7));
        if (!m) return null;
        field = m[0];
        j = i + 7 + field.length;
      }
      const close = s.indexOf(')', j);
      if (!s.startsWith('==', j) || close === -1) return null;
      const raw = s.slice(j + 2, close);
      segs.push({ filter: field, value: raw === 'true' ? true : raw === 'false' ? false : raw });
      i = close + 1;
      continue;
    }
    /* A bare key. A dot inside parentheses belongs to the key. */
    let depth = 0,
      key = '';
    while (i < s.length) {
      const c = s[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if ((c === '.' || c === '[') && depth <= 0) break;
      key += c;
      i++;
    }
    segs.push({ key });
  }
  return segs;
}

const own = (o, k) => o !== null && typeof o === 'object' && Object.hasOwn(o, k);

function extractPath(obj, dotPath) {
  if (dotPath === '(root)') return obj;
  const segs = parsePath(dotPath);
  if (!segs) return undefined;
  let cur = obj;
  for (const seg of segs) {
    if (cur == null) return undefined;
    if (seg.index !== undefined) {
      cur = Array.isArray(cur) ? cur[seg.index] : undefined;
    } else if (seg.filter !== undefined) {
      const { filter: field, value } = seg;
      cur = Array.isArray(cur) ? cur.filter(item => item && item[field] === value) : undefined;
    } else {
      const key = /** @type {string} */ (seg.key);
      if (seg.quoted) {
        cur = own(cur, key) ? cur[key] : undefined;
        continue;
      }
      if (key === '$count') return Array.isArray(cur) ? cur.length : undefined;
      /* `count` is the array-length token only on an array. On an object it is
         the field of that name. */
      if (key === 'count' && Array.isArray(cur)) return cur.length;
      cur = own(cur, key) ? cur[key] : undefined;
    }
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

module.exports = { collectNumbers, extractPath, parsePath, computeBadgeValue, computeLabelValues, firstFiringLabel };
