/* Decode the five predefined XML entities plus numeric character references.
   Anything unrecognised is left untouched rather than dropped. */
function _xmlDecode(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : m; } catch { return m; }
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e];
  });
}

/* Turn a text value into a number ONLY when the number round-trips to the exact
   original text, so genuinely-numeric fields (counts, totals) become numbers the
   badge picker can find, while IDs with leading zeros ("007"), version-like
   strings ("1.10"), exponent forms ("1e3") and oversized integers stay strings
   rather than being silently corrupted. Surrounding whitespace is trimmed before
   the check, so a padded number still coerces; a blank value stays a string. */
function _xmlCoerce(raw) {
  const t = raw.trim();
  if (t === '') return raw;
  const n = Number(t);
  if (!Number.isFinite(n)) return raw;
  if (String(n) !== t) return raw;
  if (Number.isInteger(n) && !Number.isSafeInteger(n)) return raw;
  return n;
}

/* Recursively turn a parsed element node into its plain-object value, using a
   fixed convention so a widget author (or the badge field picker) always knows
   the shape: attributes and child elements both become keys; a tag that repeats
   becomes an array, a tag that appears once stays a single value; an element
   with only text collapses to that (coerced) text; element text alongside
   attributes/children is kept under "#text". On the rare attribute/child name
   collision the child element wins. */
function _xmlValue(node) {
  const attrKeys = Object.keys(node.attrs);
  const text = _xmlDecode(node.text).trim();

  if (node.children.length === 0) {
    if (attrKeys.length === 0) return text === '' ? '' : _xmlCoerce(text);
    const obj = {};
    for (const k of attrKeys) obj[k] = _xmlCoerce(node.attrs[k]);
    if (text !== '') obj['#text'] = _xmlCoerce(text);
    return obj;
  }

  const obj = {};
  for (const k of attrKeys) obj[k] = _xmlCoerce(node.attrs[k]);
  if (text !== '') obj['#text'] = _xmlCoerce(text);
  for (const c of node.children) {
    const v = _xmlValue(c);
    if (c.tag in obj) { if (Array.isArray(obj[c.tag])) obj[c.tag].push(v); else obj[c.tag] = [obj[c.tag], v]; }
    else obj[c.tag] = v;
  }
  return obj;
}

/* General-purpose XML parser producing a nested object keyed by the root tag,
   e.g. Plex /status/sessions becomes
     { MediaContainer: { size: 1, Metadata: [ { title, duration, Player: { state } } ] } }
   which is the same shape Plex's JSON response has, so the same widget code
   reads either. Handles attributes (both quote styles), nested elements,
   repeated elements, text content, CDATA, entities, comments, the XML
   declaration, processing instructions and DOCTYPE. It is a pragmatic reader
   for well-formed API responses, not a validating parser; node and depth caps
   bound pathological input. */
/** @typedef {{ tag: string, attrs: Record<string,string>, children: XmlNode[], text: string }} XmlNode */
function parseXml(xml) {
  if (typeof xml !== 'string') return {};
  const MAX_NODES = 5000, MAX_DEPTH = 60;
  const root = /** @type {XmlNode} */ ({ tag: '#doc', attrs: {}, children: [], text: '' });
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const len = xml.length;
  let i = 0, nodes = 0;

  while (i < len) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) { top().text += xml.slice(i); break; }
    if (lt > i) top().text += xml.slice(i, lt);

    if (xml.startsWith('<!--', lt))       { const e = xml.indexOf('-->', lt + 4);  i = e === -1 ? len : e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt))  { const e = xml.indexOf(']]>', lt + 9);  top().text += xml.slice(lt + 9, e === -1 ? len : e); i = e === -1 ? len : e + 3; continue; }
    if (xml.startsWith('<?', lt))         { const e = xml.indexOf('?>', lt + 2);   i = e === -1 ? len : e + 2; continue; }
    if (xml.startsWith('<!', lt))         { const e = xml.indexOf('>', lt + 2);    i = e === -1 ? len : e + 1; continue; }

    const gt = xml.indexOf('>', lt);
    if (gt === -1) break;
    let raw = xml.slice(lt + 1, gt).trim();

    if (raw[0] === '/') {
      const name = raw.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === name) { stack.length = k; break; }
      i = gt + 1; continue;
    }

    const selfClose = raw.endsWith('/');
    if (selfClose) raw = raw.slice(0, -1).trim();
    const sp = raw.search(/\s/);
    const name = sp === -1 ? raw : raw.slice(0, sp);
    const node = /** @type {XmlNode} */ ({ tag: name, attrs: {}, children: [], text: '' });
    if (sp !== -1) {
      for (const m of raw.slice(sp + 1).matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
        node.attrs[m[1]] = _xmlDecode(m[2] !== undefined ? m[2] : m[3]);
    }
    if (++nodes > MAX_NODES) break;
    top().children.push(node);
    if (!selfClose && stack.length < MAX_DEPTH) stack.push(node);
    i = gt + 1;
  }

  const docEl = root.children.find(c => c.tag);
  return docEl ? { [docEl.tag]: _xmlValue(docEl) } : {};
}

module.exports = { parseXml };
