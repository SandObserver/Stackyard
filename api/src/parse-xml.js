/* Decode the five predefined XML entities plus numeric character references.
   Anything unrecognised is left untouched rather than dropped. */
function _xmlDecode(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      } catch {
        return m;
      }
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e];
  });
}

/* Only when the number round-trips to the original text, so an id with leading
   zeros, a version like "1.10" or an oversized integer is not corrupted. */
function _xmlCoerce(raw) {
  const t = raw.trim();
  if (t === '') return raw;
  const n = Number(t);
  if (!Number.isFinite(n)) return raw;
  if (String(n) !== t) return raw;
  if (Number.isInteger(n) && !Number.isSafeInteger(n)) return raw;
  return n;
}

/* Attributes and child elements both become keys; a repeated tag becomes an
   array; an element with only text collapses to that text, and text alongside
   children is kept under "#text". A child wins a name collision.

   Null prototype throughout: the keys are tag names taken verbatim from the
   feed, and an element called "__proto__" would otherwise replace the object's
   prototype instead of becoming a key. */
function _xmlValue(node) {
  const attrKeys = Object.keys(node.attrs);
  const text = _xmlDecode(node.text).trim();

  if (node.children.length === 0) {
    if (attrKeys.length === 0) return text === '' ? '' : _xmlCoerce(text);
    const obj = Object.create(null);
    for (const k of attrKeys) obj[k] = _xmlCoerce(node.attrs[k]);
    if (text !== '') obj['#text'] = _xmlCoerce(text);
    return obj;
  }

  const obj = Object.create(null);
  for (const k of attrKeys) obj[k] = _xmlCoerce(node.attrs[k]);
  if (text !== '') obj['#text'] = _xmlCoerce(text);
  for (const c of node.children) {
    const v = _xmlValue(c);
    if (Object.hasOwn(obj, c.tag)) {
      if (Array.isArray(obj[c.tag])) obj[c.tag].push(v);
      else obj[c.tag] = [obj[c.tag], v];
    } else obj[c.tag] = v;
  }
  return obj;
}

/* A pragmatic reader for well-formed API responses, not a validating parser.
   Node and depth caps bound pathological input.

   A capped parse returns what it read with '#truncated': true, or a partial feed
   is indistinguishable from a complete one and the badge shows a number that is
   simply wrong. MAX_NODES counts nodes, not items, since nodes are what consume
   the memory. */
/** @typedef {{ tag: string, attrs: Record<string,string>, children: XmlNode[], text: string }} XmlNode */
/* The '>' that ends a tag, ignoring any inside a quoted attribute value. A raw
   '>' there is valid XML and feeds do emit it, in an episode title for instance;
   taking the first one anywhere ends the tag mid-attribute and the damage runs
   into the sibling elements.

   @param {string} xml @param {number} from index just past the '<'
   @param {number} len @returns {number} index of the closing '>', or -1 */
function _tagEnd(xml, from, len) {
  let quote = '';
  for (let k = from; k < len; k++) {
    const c = xml[k];
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '>') return k;
  }
  return -1;
}

function parseXml(xml) {
  if (typeof xml !== 'string') return Object.create(null);
  const MAX_NODES = 5000,
    MAX_DEPTH = 60;
  const root = /** @type {XmlNode} */ ({ tag: '#doc', attrs: Object.create(null), children: [], text: '' });
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const len = xml.length;
  let i = 0,
    nodes = 0,
    truncated = false;

  while (i < len) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      top().text += xml.slice(i);
      break;
    }
    if (lt > i) top().text += xml.slice(i, lt);

    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4);
      i = e === -1 ? len : e + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      top().text += xml.slice(lt + 9, e === -1 ? len : e);
      i = e === -1 ? len : e + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const e = xml.indexOf('?>', lt + 2);
      i = e === -1 ? len : e + 2;
      continue;
    }
    /* A doctype may quote a system identifier, which can contain '>'. */
    if (xml.startsWith('<!', lt)) {
      const e = _tagEnd(xml, lt + 2, len);
      i = e === -1 ? len : e + 1;
      continue;
    }

    const gt = _tagEnd(xml, lt + 1, len);
    if (gt === -1) break;
    let raw = xml.slice(lt + 1, gt).trim();

    if (raw[0] === '/') {
      const name = raw.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k--)
        if (stack[k].tag === name) {
          stack.length = k;
          break;
        }
      i = gt + 1;
      continue;
    }

    const selfClose = raw.endsWith('/');
    if (selfClose) raw = raw.slice(0, -1).trim();
    const sp = raw.search(/\s/);
    const name = sp === -1 ? raw : raw.slice(0, sp);
    const node = /** @type {XmlNode} */ ({ tag: name, attrs: Object.create(null), children: [], text: '' });
    if (sp !== -1) {
      for (const m of raw.slice(sp + 1).matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
        node.attrs[m[1]] = _xmlDecode(m[2] !== undefined ? m[2] : m[3]);
    }
    if (++nodes > MAX_NODES) {
      truncated = true;
      break;
    }
    top().children.push(node);
    /* Past the depth cap the element is kept but nothing nested inside it is, so
       that is a truncation too. */
    if (!selfClose) {
      if (stack.length < MAX_DEPTH) stack.push(node);
      else truncated = true;
    }
    i = gt + 1;
  }

  const docEl = root.children.find(c => c.tag);
  const out = Object.create(null);
  if (docEl) out[docEl.tag] = _xmlValue(docEl);
  if (truncated) out['#truncated'] = true;
  return out;
}

module.exports = { parseXml };
